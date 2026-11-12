import { StateGraph, START, END, Command, interrupt } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

const dbPath = process.argv[2];
const mode = process.argv[3]; // 'init', 'resume-approve', 'verify'
const threadId = process.argv[4];

function nodeA(state) {
  const currentRuns = (state.executionRuns || 0) + 1;
  const approval = interrupt({ question: 'Approve high risk change?' });
  if (approval.approved) {
    return { status: 'APPROVED', verdict: 'PASS', executionRuns: currentRuns };
  }
  return { status: 'BLOCKED', verdict: 'BLOCKED', executionRuns: currentRuns };
}

const workflow = new StateGraph({
  channels: {
    status: null,
    verdict: null,
    executionRuns: { reducer: (a, b) => b ?? a, default: () => 0 }
  }
})
  .addNode('nodeA', nodeA)
  .addEdge(START, 'nodeA')
  .addEdge('nodeA', END);

const checkpointer = SqliteSaver.fromConnString(dbPath);
const app = workflow.compile({ checkpointer });
const config = { configurable: { thread_id: threadId } };

async function run() {
  if (mode === 'init') {
    try {
      await app.invoke({ status: 'PENDING' }, config);
    } catch (e) {
      // Expected interrupt throw in LangGraph
    }
    const cp = await checkpointer.get(config);
    console.log(JSON.stringify({ pid: process.pid, status: 'INTERRUPTED', values: cp?.channel_values }));
  } else if (mode === 'resume-approve') {
    const res = await app.invoke(new Command({ resume: { approved: true } }), config);
    console.log(JSON.stringify({ pid: process.pid, res, checkpoint: await checkpointer.get(config) }));
  } else if (mode === 'verify') {
    const cp = await checkpointer.get(config);
    console.log(JSON.stringify({ pid: process.pid, values: cp.channel_values }));
  }
}

run();
