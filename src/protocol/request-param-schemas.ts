import { z } from 'zod';
import { buildDefaultedString } from '../shared/build-defaulted-string';
import { MAX_BODY } from './protocol';

const PEER_SCHEMA = z.object({
  peer: z.string({ error: 'a person name or login is required' }).min(1),
});

export const REQUEST_PARAM_SCHEMAS = {
  'relay.hello': z.object({
    client: buildDefaultedString('unknown client'),
    sessionID: z
      .string({ error: 'relay.hello requires a sessionID' })
      .min(1, 'relay.hello requires a sessionID'),
    sessionName: z
      .string({ error: 'relay.hello requires a sessionName' })
      .min(1, 'relay.hello requires a sessionName'),
    cwd: buildDefaultedString(''),
    mode: buildDefaultedString(''),
    kind: z.preprocess((v) => (v === 'cli' ? v : 'session'), z.enum(['session', 'cli'])),
  }),
  'peer.list': z.object({}),
  'peer.edges': z.object({}),
  'peer.accept': PEER_SCHEMA,
  'peer.decline': PEER_SCHEMA,
  'peer.block': PEER_SCHEMA,
  'message.send': z.object({
    to: z.string({ error: 'message.send requires a to address' }).min(1),
    body: z
      .string({ error: 'message.send requires a body' })
      .min(1, 'message.send requires a body')
      .max(MAX_BODY, `message.send body is over ${MAX_BODY} bytes`),
  }),
  'message.ack': z.object({
    id: z.string({ error: 'message.ack requires an id' }).min(1),
  }),
};
