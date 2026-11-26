require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  Events
} = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const logChannelId = process.env.LOG_CHANNEL_ID;
const showMessageContent = process.env.LOG_MESSAGE_CONTENT !== "false";

if (!token) {
  console.error("Не задан DISCORD_BOT_TOKEN. Создай файл .env по примеру .env.example.");
  process.exit(1);
}

if (!logChannelId) {
  console.error("Не задан LOG_CHANNEL_ID. Укажи ID канала для логов в .env.");
  process.exit(1);
}

// GuildVoiceStates намеренно отсутствует. События голосовых каналов не собираются.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildExpressions,
    GatewayIntentBits.GuildScheduledEvents,
    GatewayIntentBits.MessageContent
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember,
    Partials.Reaction
  ]
});

const COLORS = {
  info: 0x3498db,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  danger: 0xe74c3c,
  purple: 0x9b59b6
};

function clip(value, maxLength) {
  const text = String(value ?? "—");
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function userLabel(user) {
  if (!user) return "Неизвестный пользователь";
  return (user.tag || user.username || "Пользователь") + " (ID: " + user.id + ")";
}

function channelLabel(channel) {
  if (!channel) return "Неизвестный канал";
  return (channel.name ? "#" + channel.name : "канал") + " (ID: " + channel.id + ")";
}

function guildForMessage(message) {
  return message.guild || (message.guildId ? client.guilds.cache.get(message.guildId) : null);
}

async function sendLog(guild, title, description, fields = [], color = COLORS.info) {
  if (!logChannelId) {
    console.warn("LOG_CHANNEL_ID пока не задан. Событие пропущено:", title);
    return;
  }
  try {
    const channel =
      client.channels.cache.get(logChannelId) ||
      await client.channels.fetch(logChannelId).catch(() => null);

    if (!channel || !channel.isTextBased() || typeof channel.send !== "function") {
      console.error("Канал логов не найден или в него нельзя отправлять сообщения. ID:", logChannelId);
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(clip(title, 256))
      .setTimestamp();

    if (description) embed.setDescription(clip(description, 4096));

    const validFields = fields
      .filter((field) => field && field.name)
      .slice(0, 25)
      .map((field) => ({
        name: clip(field.name, 256),
        value: clip(field.value || "—", 1024),
        inline: Boolean(field.inline)
      }));

    if (validFields.length) embed.addFields(validFields);

    if (guild) {
      embed.setFooter({ text: clip(guild.name + " • " + guild.id, 2048) });
    }

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] }
    });
  } catch (error) {
    console.error("Не удалось отправить запись в канал логов:", error);
  }
}

async function resolveMessage(message) {
  if (!message) return null;
  if (!message.partial) return message;
  return message.fetch().catch(() => message);
}

function messageText(message) {
  if (!showMessageContent) {
    return "Содержимое скрыто: LOG_MESSAGE_CONTENT=false";
  }

  const content = message.content && message.content.trim()
    ? message.content
    : "(текст отсутствует или недоступен)";

  const attachments = message.attachments
    ? Array.from(message.attachments.values()).map((file) => file.url)
    : [];

  return clip(
    content + (attachments.length ? "\nВложения:\n" + attachments.join("\n") : ""),
    1024
  );
}

function isLogChannel(channelId) {
  return Boolean(channelId && channelId === logChannelId);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log("Discord Logger запущен как " + readyClient.user.tag);
  console.log("Канал логов: " + logChannelId);
  console.log("Содержимое сообщений: " + (showMessageContent ? "включено" : "выключено"));
  console.log("Логи голосовых каналов: отключены");
});

client.on(Events.GuildCreate, async (guild) => {
  await sendLog(guild, "Бот добавлен на сервер", "Discord Logger подключился к серверу.", [
    { name: "Участников", value: String(guild.memberCount), inline: true },
    { name: "ID сервера", value: guild.id, inline: true }
  ], COLORS.success);
});

client.on(Events.GuildDelete, async (guild) => {
  await sendLog(guild, "Бот удалён с сервера", "Бот больше не состоит на этом сервере.", [
    { name: "ID сервера", value: guild.id, inline: true }
  ], COLORS.warning);
});

// Участники
client.on(Events.GuildMemberAdd, async (member) => {
  await sendLog(member.guild, "Участник присоединился", userLabel(member.user), [
    { name: "Аккаунт создан", value: member.user.createdAt.toLocaleString("ru-RU"), inline: true },
    { name: "Участников на сервере", value: String(member.guild.memberCount), inline: true }
  ], COLORS.success);
});

client.on(Events.GuildMemberRemove, async (member) => {
  await sendLog(member.guild, "Участник покинул сервер", userLabel(member.user), [
    { name: "ID пользователя", value: member.id, inline: true },
    { name: "Участников на сервере", value: String(member.guild.memberCount), inline: true }
  ], COLORS.warning);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  const fields = [];
  if (oldMember.nickname !== newMember.nickname) {
    fields.push({
      name: "Никнейм",
      value: (oldMember.nickname || "Отсутствовал") + " → " + (newMember.nickname || "Отсутствует")
    });
  }

  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());
  const added = newMember.roles.cache.filter((role) => !oldRoles.has(role.id) && role.id !== newMember.guild.id);
  const removed = oldMember.roles.cache.filter((role) => !newRoles.has(role.id) && role.id !== newMember.guild.id);

  if (added.size) fields.push({ name: "Выданы роли", value: added.map((role) => role.name).join(", ") });
  if (removed.size) fields.push({ name: "Сняты роли", value: removed.map((role) => role.name).join(", ") });

  if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
    fields.push({
      name: "Тайм-аут",
      value: newMember.communicationDisabledUntil
        ? "До " + newMember.communicationDisabledUntil.toLocaleString("ru-RU")
        : "Снят или завершён"
    });
  }

  if (fields.length) {
    await sendLog(newMember.guild, "Изменён участник", userLabel(newMember.user), fields, COLORS.purple);
  }
});

// Сообщения: удаление, изменение и массовое удаление. Новые сообщения не архивируются.
client.on(Events.MessageDelete, async (rawMessage) => {
  const message = await resolveMessage(rawMessage);
  const guild = guildForMessage(message);
  if (!guild || isLogChannel(message.channelId) || message.author?.bot) return;

  await sendLog(guild, "Сообщение удалено", userLabel(message.author), [
    { name: "Канал", value: channelLabel(message.channel) },
    { name: "Содержимое", value: messageText(message) }
  ], COLORS.danger);
});

client.on(Events.MessageUpdate, async (oldRawMessage, newRawMessage) => {
  const oldMessage = await resolveMessage(oldRawMessage);
  const newMessage = await resolveMessage(newRawMessage);
  const guild = guildForMessage(newMessage);
  if (!guild || isLogChannel(newMessage.channelId) || newMessage.author?.bot) return;
  if (oldMessage.content === newMessage.content) return;

  await sendLog(guild, "Сообщение изменено", userLabel(newMessage.author), [
    { name: "Канал", value: channelLabel(newMessage.channel) },
    { name: "До изменения", value: messageText(oldMessage) },
    { name: "После изменения", value: messageText(newMessage) },
    { name: "Ссылка", value: newMessage.url || "Недоступна" }
  ], COLORS.warning);
});

client.on(Events.MessageDeleteBulk, async (messages) => {
  const firstMessage = messages.first();
  if (!firstMessage) return;
  const guild = guildForMessage(firstMessage);
  if (!guild || isLogChannel(firstMessage.channelId)) return;

  await sendLog(guild, "Массовое удаление сообщений", "Удалено сообщений: " + messages.size, [
    { name: "Канал", value: channelLabel(firstMessage.channel) }
  ], COLORS.danger);
});

// Каналы
client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild) return;
  await sendLog(channel.guild, "Создан канал", channelLabel(channel), [
    { name: "Тип", value: String(channel.type), inline: true },
    { name: "ID канала", value: channel.id, inline: true }
  ], COLORS.success);
});

client.on(Events.ChannelDelete, async (channel) => {
  if (!channel.guild) return;
  await sendLog(channel.guild, "Удалён канал", channelLabel(channel), [
    { name: "ID канала", value: channel.id, inline: true }
  ], COLORS.danger);
});

client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push("Название: " + oldChannel.name + " → " + newChannel.name);
  if ("topic" in oldChannel && oldChannel.topic !== newChannel.topic) {
    changes.push("Описание: " + (oldChannel.topic || "нет") + " → " + (newChannel.topic || "нет"));
  }
  if (oldChannel.parentId !== newChannel.parentId) changes.push("Категория изменена");
  if (oldChannel.nsfw !== newChannel.nsfw) changes.push("NSFW: " + oldChannel.nsfw + " → " + newChannel.nsfw);
  if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
    changes.push("Медленный режим: " + oldChannel.rateLimitPerUser + " → " + newChannel.rateLimitPerUser);
  }
  if (changes.length) {
    await sendLog(newChannel.guild, "Изменён канал", channelLabel(newChannel), [
      { name: "Изменения", value: changes.join("\n") }
    ], COLORS.warning);
  }
});

// Роли
client.on(Events.GuildRoleCreate, async (role) => {
  await sendLog(role.guild, "Создана роль", role.name, [
    { name: "ID роли", value: role.id, inline: true },
    { name: "Цвет", value: role.hexColor, inline: true }
  ], COLORS.success);
});

client.on(Events.GuildRoleDelete, async (role) => {
  await sendLog(role.guild, "Удалена роль", role.name, [
    { name: "ID роли", value: role.id, inline: true }
  ], COLORS.danger);
});

client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push("Название: " + oldRole.name + " → " + newRole.name);
  if (oldRole.hexColor !== newRole.hexColor) changes.push("Цвет: " + oldRole.hexColor + " → " + newRole.hexColor);
  if (oldRole.hoist !== newRole.hoist) changes.push("Отображение отдельно: " + oldRole.hoist + " → " + newRole.hoist);
  if (oldRole.mentionable !== newRole.mentionable) changes.push("Упоминание: " + oldRole.mentionable + " → " + newRole.mentionable);
  if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push("Изменены разрешения");

  if (changes.length) {
    await sendLog(newRole.guild, "Изменена роль", newRole.name, [
      { name: "Изменения", value: changes.join("\n") }
    ], COLORS.warning);
  }
});

// Блокировки
client.on(Events.GuildBanAdd, async (ban) => {
  await sendLog(ban.guild, "Участник заблокирован", userLabel(ban.user), [
    { name: "Причина", value: ban.reason || "Не указана" }
  ], COLORS.danger);
});

client.on(Events.GuildBanRemove, async (ban) => {
  await sendLog(ban.guild, "Блокировка снята", userLabel(ban.user), [], COLORS.success);
});

// Приглашения
client.on(Events.InviteCreate, async (invite) => {
  if (!invite.guild) return;
  await sendLog(invite.guild, "Создано приглашение", "Код: " + invite.code, [
    { name: "Канал", value: channelLabel(invite.channel), inline: true },
    { name: "Создатель", value: userLabel(invite.inviter), inline: true },
    { name: "Лимит использований", value: String(invite.maxUses || "Без лимита"), inline: true }
  ], COLORS.success);
});

client.on(Events.InviteDelete, async (invite) => {
  if (!invite.guild) return;
  await sendLog(invite.guild, "Приглашение удалено", "Код: " + invite.code, [
    { name: "Канал", value: channelLabel(invite.channel) }
  ], COLORS.warning);
});

// Реакции
client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
  const message = await resolveMessage(reaction.message);
  const guild = guildForMessage(message);
  if (!guild || isLogChannel(message.channelId)) return;

  await sendLog(guild, "Добавлена реакция", userLabel(user), [
    { name: "Реакция", value: reaction.emoji.toString(), inline: true },
    { name: "Канал", value: channelLabel(message.channel), inline: true },
    { name: "Сообщение", value: message.url || "Ссылка недоступна" }
  ], COLORS.info);
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) reaction = await reaction.fetch().catch(() => reaction);
  const message = await resolveMessage(reaction.message);
  const guild = guildForMessage(message);
  if (!guild || isLogChannel(message.channelId)) return;

  await sendLog(guild, "Удалена реакция", userLabel(user), [
    { name: "Реакция", value: reaction.emoji.toString(), inline: true },
    { name: "Канал", value: channelLabel(message.channel), inline: true },
    { name: "Сообщение", value: message.url || "Ссылка недоступна" }
  ], COLORS.warning);
});

// Эмодзи и стикеры
client.on("emojiCreate", async (emoji) => {
  await sendLog(emoji.guild, "Создан эмодзи", emoji.name || emoji.id, [
    { name: "ID", value: emoji.id, inline: true }
  ], COLORS.success);
});

client.on("emojiDelete", async (emoji) => {
  await sendLog(emoji.guild, "Удалён эмодзи", emoji.name || emoji.id, [
    { name: "ID", value: emoji.id, inline: true }
  ], COLORS.danger);
});

client.on("emojiUpdate", async (oldEmoji, newEmoji) => {
  await sendLog(newEmoji.guild, "Изменён эмодзи", oldEmoji.name + " → " + newEmoji.name, [
    { name: "ID", value: newEmoji.id, inline: true }
  ], COLORS.warning);
});

client.on("stickerCreate", async (sticker) => {
  if (sticker.guild) await sendLog(sticker.guild, "Создан стикер", sticker.name, [
    { name: "ID", value: sticker.id, inline: true }
  ], COLORS.success);
});

client.on("stickerDelete", async (sticker) => {
  if (sticker.guild) await sendLog(sticker.guild, "Удалён стикер", sticker.name, [
    { name: "ID", value: sticker.id, inline: true }
  ], COLORS.danger);
});

client.on("stickerUpdate", async (oldSticker, newSticker) => {
  if (newSticker.guild) await sendLog(newSticker.guild, "Изменён стикер", oldSticker.name + " → " + newSticker.name, [
    { name: "ID", value: newSticker.id, inline: true }
  ], COLORS.warning);
});

// Ветки обсуждений и запланированные события
client.on(Events.ThreadCreate, async (thread) => {
  await sendLog(thread.guild, "Создана ветка", thread.name, [
    { name: "Родительский канал", value: channelLabel(thread.parent), inline: true },
    { name: "ID ветки", value: thread.id, inline: true }
  ], COLORS.success);
});

client.on(Events.ThreadDelete, async (thread) => {
  await sendLog(thread.guild, "Удалена ветка", thread.name, [
    { name: "ID ветки", value: thread.id, inline: true }
  ], COLORS.danger);
});

client.on(Events.ThreadUpdate, async (oldThread, newThread) => {
  if (oldThread.name !== newThread.name || oldThread.archived !== newThread.archived || oldThread.locked !== newThread.locked) {
    await sendLog(newThread.guild, "Изменена ветка", newThread.name, [
      { name: "Состояние", value: "Архив: " + newThread.archived + ", блокировка: " + newThread.locked }
    ], COLORS.warning);
  }
});

client.on(Events.GuildScheduledEventCreate, async (event) => {
  await sendLog(event.guild, "Создано запланированное событие", event.name, [
    { name: "Начало", value: event.scheduledStartAt ? event.scheduledStartAt.toLocaleString("ru-RU") : "Не указано" }
  ], COLORS.success);
});

client.on(Events.GuildScheduledEventDelete, async (event) => {
  await sendLog(event.guild, "Удалено запланированное событие", event.name, [], COLORS.danger);
});

client.on(Events.GuildScheduledEventUpdate, async (oldEvent, newEvent) => {
  await sendLog(newEvent.guild, "Изменено запланированное событие", newEvent.name, [
    { name: "Название", value: oldEvent.name + " → " + newEvent.name }
  ], COLORS.warning);
});

// Обновление вебхуков: Discord сообщает о факте изменения, но не передаёт детали.
client.on(Events.WebhooksUpdate, async (channel) => {
  if (!channel.guild) return;
  await sendLog(channel.guild, "Обновлены вебхуки", channelLabel(channel), [], COLORS.warning);
});

// Действия AutoMod
client.on(Events.AutoModerationActionExecution, async (execution) => {
  const guild = client.guilds.cache.get(execution.guildId);
  if (!guild) return;

  await sendLog(guild, "Сработала автоматическая модерация", "Discord AutoMod выполнил действие.", [
    { name: "Пользователь", value: execution.userId || "Неизвестно", inline: true },
    { name: "Канал", value: execution.channelId || "Не указан", inline: true },
    { name: "ID правила", value: execution.ruleId || "Не указан", inline: true }
  ], COLORS.danger);
});

client.on(Events.Error, (error) => {
  console.error("Ошибка Discord-клиента:", error);
});

client.login(token).catch((error) => {
  console.error("Не удалось запустить бота. Проверь DISCORD_BOT_TOKEN:", error);
  process.exit(1);
});
