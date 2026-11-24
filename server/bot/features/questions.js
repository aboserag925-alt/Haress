'use strict';

function register(bot) {
  const service = bot.ctx.questionService;
  if (!service) return;
  bot.registerCallback('q', function (ctx, callback) { return service.handleCallback(ctx, callback); });
  bot.registerMessageHandler(function (ctx, message) { return service.handleReply(ctx, message); });
}

module.exports = { register };
