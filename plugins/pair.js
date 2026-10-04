module.exports = {
  command: "pair",
  description: "Create an isolated WhatsApp session for another number",
  async run({ args, reply, config }) {
    const phone = args[0];
    if (!phone) return reply(`Usage: ${config.prefix}pair <phone-number>\nExample: ${config.prefix}pair 255625606354\nWeb pairing: ${process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`}/pair`);
    try {
      await reply("⏳ Creating an isolated Aura-XMD session and requesting a pairing code...");
      const result = await config.pairManager.pair(phone);
      if (result.error) return reply(`❌ Pairing failed: ${result.error}`);
      return reply(`✅ Pairing code: ${result.code}\n\nOn the phone: WhatsApp → Linked devices → Link a device → Link with phone number instead.\nEnter the code within the next few minutes. This number will have its own isolated session.`);
    } catch (error) {
      return reply(`❌ Could not create the session: ${error.message}`);
    }
  }
};
