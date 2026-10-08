function getParticipantId(value) {
  return String(value || "").split(":")[0];
}

function getMentionedJids(msg) {
  const context = msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo || {};
  return [...(context.mentionedJid || [])];
}

function getTargetJids(msg, args = []) {
  const mentioned = getMentionedJids(msg);
  if (mentioned.length) return mentioned;
  const context = msg?.message?.extendedTextMessage?.contextInfo || {};
  if (context.participant) return [context.participant];
  return args.filter(arg => /^\+?\d{7,15}$/.test(arg.replace(/[^\d+]/g, "")))
    .map(arg => `${arg.replace(/\D/g, "")}@s.whatsapp.net`);
}

function getQuotedMessage(msg) {
  const context = msg?.message?.extendedTextMessage?.contextInfo ||
    msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo || {};
  if (!context.quotedMessage) return null;
  return {
    key: { remoteJid: msg.key.remoteJid, fromMe: false, id: context.stanzaId, participant: context.participant },
    message: context.quotedMessage
  };
}

async function getGroupMetadata(sock, jid) {
  if (!jid.endsWith("@g.us")) throw new Error("This command can only be used in a group.");
  return sock.groupMetadata(jid);
}

async function isGroupAdmin(sock, jid, userJid) {
  const metadata = await getGroupMetadata(sock, jid);
  const user = metadata.participants.find(item => item.id === userJid || item.lid === userJid);
  return Boolean(user?.admin);
}

function bareIdentity(value) {
  return String(value || "").toLowerCase().split("@")[0].split(":")[0];
}
function phoneIdentity(value) {
  return bareIdentity(value).replace(/\D/g, "");
}
function identityMatches(left, right) {
  const a = bareIdentity(left);
  const b = bareIdentity(right);
  return Boolean(a && b && (a === b || (phoneIdentity(a) && phoneIdentity(a) === phoneIdentity(b))));
}

function isOwner(sock, config, msg) {
  // A message sent by the linked WhatsApp account is always an owner action.
  if (msg?.key?.fromMe === true) return true;

  const senderCandidates = [msg?.key?.participant, msg?.key?.remoteJid].filter(Boolean);
  const accountCandidates = [sock?.user?.id, sock?.user?.lid, sock?.user?.jid].filter(Boolean);
  if (senderCandidates.some(sender => accountCandidates.some(account => identityMatches(sender, account)))) return true;

  const configuredOwner = phoneIdentity(config?.ownerNumber);
  return Boolean(configuredOwner && senderCandidates.some(sender => phoneIdentity(sender) === configuredOwner));
}

async function requireGroupAdmin({ sock, jid, msg, config, reply }) {
  if (isOwner(sock, config, msg)) return true;
  const sender = msg.key.participant || msg.key.remoteJid;
  if (!(await isGroupAdmin(sock, jid, sender))) {
    await reply("⛔ Group-admin permission required.");
    return false;
  }
  return true;
}

async function requireBotAdmin(sock, jid, reply) {
  const metadata = await getGroupMetadata(sock, jid);
  const botIds = [sock?.user?.id, sock?.user?.lid].filter(Boolean).map(bareIdentity);
  const bot = metadata.participants.find(item => botIds.includes(bareIdentity(item.id)) || botIds.includes(bareIdentity(item.lid)));
  if (!bot?.admin) {
    await reply("⛔ Make Aura an admin first.");
    return false;
  }
  return true;
}

function containsLink(text) {
  return /(?:https?:\/\/|www\.|chat\.whatsapp\.com\/|t\.me\/|discord\.gg\/)[^\s]+/i.test(text);
}

module.exports = {
  getParticipantId,
  getMentionedJids,
  getTargetJids,
  getQuotedMessage,
  getGroupMetadata,
  isGroupAdmin,
  isOwner,
  requireGroupAdmin,
  requireBotAdmin,
  containsLink
};
