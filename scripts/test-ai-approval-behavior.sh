#!/usr/bin/env bash
set -Eeuo pipefail
export LC_ALL=C

: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=haress_migrations}"
: "${PGUSER:=postgres}"
export PGHOST PGPORT PGDATABASE PGUSER

command -v psql >/dev/null 2>&1 || { echo "psql is required" >&2; exit 127; }

ADMIN=00000000-0000-0000-0000-000000000001
NONADMIN=00000000-0000-0000-0000-000000000002
ANON_TASK=00000000-0000-0000-0000-000000000101
NONADMIN_TASK=00000000-0000-0000-0000-000000000102
TAINTED_TASK=00000000-0000-0000-0000-000000000103
EARLY_MERGE_TASK=00000000-0000-0000-0000-000000000104
DUPLICATE_TASK=00000000-0000-0000-0000-000000000105
AUDIT_TASK=00000000-0000-0000-0000-000000000106
LEGACY_APPROVAL_TASK=00000000-0000-0000-0000-000000000107
MERGE_TASK=00000000-0000-0000-0000-000000000108
NO_REASON_TASK=00000000-0000-0000-0000-000000000109
AUDIT_ROLLBACK_TASK=00000000-0000-0000-0000-000000000110

psql --no-psqlrc -v ON_ERROR_STOP=1 <<SQL
INSERT INTO auth.users(id) VALUES ('$ADMIN'), ('$NONADMIN') ON CONFLICT DO NOTHING;
INSERT INTO public.admin_users(user_id) VALUES ('$ADMIN') ON CONFLICT DO NOTHING;
INSERT INTO public.ai_tasks(id,status,risk,tainted,source)
VALUES
 ('$ANON_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$NONADMIN_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$TAINTED_TASK','WAITING_APPROVAL','low',true,'internal'),
 ('$EARLY_MERGE_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$DUPLICATE_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$AUDIT_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$LEGACY_APPROVAL_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$MERGE_TASK','READY_FOR_REVIEW','low',false,'internal'),
 ('$NO_REASON_TASK','WAITING_APPROVAL','low',false,'internal'),
 ('$AUDIT_ROLLBACK_TASK','WAITING_APPROVAL','low',false,'internal');
SQL

snapshot() {
  local task="$1"
  psql --no-psqlrc -At -v ON_ERROR_STOP=1 -c "
    SELECT status || '|' ||
      (SELECT count(*) FROM public.ai_approvals WHERE task_id='$task') || '|' ||
      (SELECT count(*) FROM public.ai_audit_events WHERE metadata->>'task_id'='$task')
    FROM public.ai_tasks WHERE id='$task';
  " | tr -d '[:space:]'
}

expect_rejection() {
  local task="$1" action="$2" decision="$3" actor="$4" reason="$5" expected="$6"
  local before after output
  before="$(snapshot "$task")"
  if output="$(psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.record_ai_approval('$task','$actor','$action','$decision','$reason');" 2>&1)"; then
    if [[ "${EXPECT_MISSING_GUARD:-}" == "tainted" && "$expected" == "Tainted tasks cannot be approved" ]]; then
      echo "EXPECTED_GUARD_FAILURE:tainted"
      echo "Without #128 the tainted task was incorrectly accepted."
      exit 42
    fi
    echo "FAIL: expected rejection containing: $expected" >&2
    echo "$output" >&2
    exit 1
  fi
  if ! grep -Fq "$expected" <<<"$output"; then
    echo "FAIL: wrong rejection; expected: $expected" >&2
    echo "$output" >&2
    exit 1
  fi
  after="$(snapshot "$task")"
  if [[ "$before" != "$after" ]]; then
    echo "FAIL: rejected call mutated task/approval/audit snapshot: $before -> $after" >&2
    exit 1
  fi
  echo "PASS rejection [$expected] unchanged=$after"
}

expect_permission_denied() {
  local role="$1" task="$2" before after output
  before="$(snapshot "$task")"
  if output="$(psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE $role; SELECT public.record_ai_approval('$task','$ADMIN','IMPLEMENT','APPROVED','permission test');" 2>&1)"; then
    echo "FAIL: $role executed record_ai_approval" >&2
    exit 1
  fi
  if ! grep -Fq "permission denied for function record_ai_approval" <<<"$output"; then
    echo "FAIL: unexpected $role error" >&2
    echo "$output" >&2
    exit 1
  fi
  after="$(snapshot "$task")"
  [[ "$before" == "$after" ]] || { echo "FAIL: $role denial changed data: $before -> $after" >&2; exit 1; }
  echo "PASS $role denied; unchanged=$after"
}

expect_permission_denied anon "$ANON_TASK"
expect_permission_denied authenticated "$ANON_TASK"
expect_rejection "$NONADMIN_TASK" IMPLEMENT APPROVED "$NONADMIN" "non-admin test" "Actor is not an authorized administrator"
expect_rejection "$TAINTED_TASK" IMPLEMENT APPROVED "$ADMIN" "taint test" "Tainted tasks cannot be approved"
expect_rejection "$EARLY_MERGE_TASK" MERGE APPROVED "$ADMIN" "early merge test" "Task is not ready for human review"
expect_rejection "$NO_REASON_TASK" IMPLEMENT REJECTED "$ADMIN" "" "Invalid approval request"

# A valid approval must update the task and create exactly one approval and audit row.
psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.record_ai_approval('$DUPLICATE_TASK','$ADMIN','IMPLEMENT','APPROVED','first decision');" >/dev/null
expected_snapshot="APPROVED|1|1"
actual_snapshot="$(snapshot "$DUPLICATE_TASK")"
[[ "$actual_snapshot" == "$expected_snapshot" ]] || {
  echo "FAIL: accepted decision did not create exactly one approval and audit event: $actual_snapshot" >&2
  exit 1
}
echo "PASS accepted decision + audit row=$actual_snapshot"
expect_rejection "$DUPLICATE_TASK" IMPLEMENT REJECTED "$ADMIN" "second decision" "Task is not waiting for implementation approval"

# A legacy approval row must be reused/updated, not treated as a duplicate.
psql --no-psqlrc -v ON_ERROR_STOP=1 <<SQL
INSERT INTO public.ai_approvals(task_id,actor_user_id,action,decision,reason)
VALUES ('$LEGACY_APPROVAL_TASK','$ADMIN','IMPLEMENT','REJECTED','historical decision');
SQL
psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.record_ai_approval('$LEGACY_APPROVAL_TASK','$ADMIN','IMPLEMENT','APPROVED','re-approved legacy row');" >/dev/null
legacy_snapshot="$(snapshot "$LEGACY_APPROVAL_TASK")"
legacy_decision="$(psql --no-psqlrc -At -c "SELECT decision FROM public.ai_approvals WHERE task_id='$LEGACY_APPROVAL_TASK' AND action='IMPLEMENT';" | tr -d '[:space:]')"
[[ "$legacy_snapshot" == "APPROVED|1|1" && "$legacy_decision" == "APPROVED" ]] || {
  echo "FAIL: existing approval row was not reused correctly: $legacy_snapshot decision=$legacy_decision" >&2
  exit 1
}
echo "PASS WAITING_APPROVAL task with historical approval row accepted and reused"

# MERGE approval succeeds only from READY_FOR_REVIEW.
psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.record_ai_approval('$MERGE_TASK','$ADMIN','MERGE','APPROVED','merge approved');" >/dev/null
merge_snapshot="$(snapshot "$MERGE_TASK")"
merge_status="$(psql --no-psqlrc -At -c "SELECT status FROM public.ai_tasks WHERE id='$MERGE_TASK';" | tr -d '[:space:]')"
[[ "$merge_snapshot" == "HUMAN_APPROVED|1|1" && "$merge_status" == "HUMAN_APPROVED" ]] || {
  echo "FAIL: successful MERGE did not update task and audit atomically: $merge_snapshot status=$merge_status" >&2
  exit 1
}
echo "PASS MERGE accepted from READY_FOR_REVIEW with one approval and audit row"

# A failed audit insert must roll back both the approval insert and task update.
psql --no-psqlrc -v ON_ERROR_STOP=1 <<SQL
CREATE FUNCTION public.test_fail_ai_approval_audit() RETURNS trigger
LANGUAGE plpgsql AS \$\$
BEGIN
  IF NEW.metadata->>'task_id' = '$AUDIT_ROLLBACK_TASK' THEN
    RAISE EXCEPTION 'forced audit failure for rollback test';
  END IF;
  RETURN NEW;
END;
\$\$;
CREATE TRIGGER test_fail_ai_approval_audit
BEFORE INSERT ON public.ai_audit_events
FOR EACH ROW EXECUTE FUNCTION public.test_fail_ai_approval_audit();
SQL
before_rollback="$(snapshot "$AUDIT_ROLLBACK_TASK")"
if rollback_output="$(psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT public.record_ai_approval('$AUDIT_ROLLBACK_TASK','$ADMIN','IMPLEMENT','APPROVED','rollback audit test');" 2>&1)"; then
  echo "FAIL: approval succeeded despite forced audit failure" >&2
  exit 1
fi
grep -Fq "forced audit failure for rollback test" <<<"$rollback_output" || {
  echo "FAIL: unexpected audit failure: $rollback_output" >&2
  exit 1
}
after_rollback="$(snapshot "$AUDIT_ROLLBACK_TASK")"
[[ "$before_rollback" == "$after_rollback" && "$after_rollback" == "WAITING_APPROVAL|0|0" ]] || {
  echo "FAIL: audit failure did not roll back the complete operation: $before_rollback -> $after_rollback" >&2
  exit 1
}
psql --no-psqlrc -v ON_ERROR_STOP=1 -c "DROP TRIGGER test_fail_ai_approval_audit ON public.ai_audit_events; DROP FUNCTION public.test_fail_ai_approval_audit();" >/dev/null
echo "PASS audit insert failure rolled back task, approval, and audit state"


# Separate psql processes create separate PostgreSQL connections. Each round
# races opposite decisions against one task; row locking must allow exactly one.
for round in $(seq 1 20); do
  task="$(printf '00000000-0000-0000-0000-%012d' "$((1000 + round))")"
  psql --no-psqlrc -v ON_ERROR_STOP=1 -c "INSERT INTO public.ai_tasks(id,status,risk,tainted,source) VALUES ('$task','WAITING_APPROVAL','low',false,'internal');"
  out_a="$(mktemp)"
  out_b="$(mktemp)"
  psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT pg_sleep(0.15); SELECT public.record_ai_approval('$task','$ADMIN','IMPLEMENT','APPROVED','concurrency round $round');" >"$out_a" 2>&1 &
  pid_a=$!
  psql --no-psqlrc -v ON_ERROR_STOP=1 -c "SET ROLE service_role; SELECT pg_sleep(0.15); SELECT public.record_ai_approval('$task','$ADMIN','IMPLEMENT','REJECTED','concurrency rejection round $round');" >"$out_b" 2>&1 &
  pid_b=$!
  rc_a=0; wait "$pid_a" || rc_a=$?
  rc_b=0; wait "$pid_b" || rc_b=$?
  if ! { [[ "$rc_a" -eq 0 && "$rc_b" -ne 0 ]] || [[ "$rc_a" -ne 0 && "$rc_b" -eq 0 ]]; }; then
    echo "FAIL: concurrency round $round did not produce exactly one winner (rc=$rc_a,$rc_b)" >&2
    cat "$out_a" "$out_b" >&2
    rm -f "$out_a" "$out_b"
    exit 1
  fi
  failed_output="$out_a"
  [[ "$rc_a" -ne 0 ]] || failed_output="$out_b"
  if ! grep -Fq "Task is not waiting for implementation approval" "$failed_output"; then
    echo "FAIL: concurrency round $round lost call for an unexpected reason" >&2
    cat "$out_a" "$out_b" >&2
    rm -f "$out_a" "$out_b"
    exit 1
  fi
  result="$(snapshot "$task")"
  approval_count="$(cut -d'|' -f2 <<<"$result")"
  audit_count="$(cut -d'|' -f3 <<<"$result")"
  if [[ "$approval_count" != "1" || "$audit_count" != "1" ]]; then
    echo "FAIL: concurrency round $round produced $result" >&2
    rm -f "$out_a" "$out_b"
    exit 1
  fi
  echo "PASS concurrency round $round: one winner, one approval, one audit row ($result)"
  rm -f "$out_a" "$out_b"
done

echo "PASS: AI approval behavioral suite, including 20 independent-connection races."
