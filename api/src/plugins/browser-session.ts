import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { SessionService } from "../services/session.service.js";
import { SessionPersistenceService } from "../services/session-persistence.service.js";

const browserSessionPlugin: FastifyPluginAsync = async (fastify, _options) => {
  // Initialize session persistence service
  const persistenceService = new SessionPersistenceService(fastify.log);
  await persistenceService.connect();

  const sessionService = new SessionService({
    cdpService: fastify.cdpService,
    seleniumService: fastify.seleniumService,
    fileService: fastify.fileService,
    logger: fastify.log,
    persistenceService,
  });

  fastify.decorate("sessionService", sessionService);
  fastify.decorate("sessionPersistenceService", persistenceService);

  // Cleanup on close
  fastify.addHook("onClose", async () => {
    await persistenceService.disconnect();
  });
};

export default fp(browserSessionPlugin, "5.x");
