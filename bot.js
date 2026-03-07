const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits,
  ChannelType
} = require("discord.js");

const config = require("./config.json");

const {
  token,
  guildId,
  panelChannelId,
  staffRoleId,
  ownerId,
  logsChannelId
} = config;

// تحميل بيانات التذاكر
function loadTickets() {
  return JSON.parse(fs.readFileSync("tickets.json", "utf8"));
}

function saveTickets(data) {
  fs.writeFileSync("tickets.json", JSON.stringify(data, null, 2));
}

function getNextTicketNumber() {
  const data = loadTickets();
  data.lastTicket += 1;
  saveTickets(data);
  return data.lastTicket.toString().padStart(4, "0");
}

function userHasOpenTicket(userId, type) {
  const data = loadTickets();
  return data.tickets.some(
    (t) => t.userId === userId && t.type === type && t.status === "open"
  );
}

function addTicketRecord(ticket) {
  const data = loadTickets();
  data.tickets.push(ticket);
  saveTickets(data);
}

function closeTicketRecord(channelId) {
  const data = loadTickets();
  const ticket = data.tickets.find((t) => t.channelId === channelId);
  if (ticket) ticket.status = "closed";
  saveTickets(data);
  return ticket;
}

// إنشاء العميل
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});
// تسجيل أوامر السلاش
client.on("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const commands = [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("إنشاء لوحة التذاكر")
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(token);

  try {
    await rest.put(Routes.applicationGuildCommands(client.user.id, guildId), {
      body: commands
    });
    console.log("Commands registered.");
  } catch (err) {
    console.error(err);
  }
});

// تنفيذ أمر /panel
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "panel") {
    const embed = new EmbedBuilder()
      .setColor("#2b2d31")
      .setTitle("🎫 نظام التذاكر — Esro Ticket")
      .setDescription("اختر نوع التذكرة من القائمة بالأسفل")
      .setFooter({ text: "Esro Ticket System" });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("ticket_type")
      .setPlaceholder("اختر نوع التذكرة")
      .addOptions([
        {
          label: "شراء",
          value: "buy",
          emoji: "🛒"
        },
        {
          label: "استفسار",
          value: "ask",
          emoji: "❓"
        },
        {
          label: "بلاغ",
          value: "report",
          emoji: "🚨"
        }
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    await interaction.reply({
      content: "تم إنشاء لوحة التذاكر.",
      ephemeral: true
    });

    const panelChannel = client.channels.cache.get(panelChannelId);
    panelChannel.send({ embeds: [embed], components: [row] });
  }
});
// فتح التذكرة عند اختيار النوع
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "ticket_type") return;

  const type = interaction.values[0];
  const user = interaction.user;

  if (userHasOpenTicket(user.id, type)) {
    return interaction.reply({
      content: "⚠️ لديك تذكرة مفتوحة بالفعل من هذا النوع.",
      ephemeral: true
    });
  }

  const ticketNumber = getNextTicketNumber();

  const channel = await interaction.guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    parent: null,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ]
  });

  addTicketRecord({
    number: ticketNumber,
    userId: user.id,
    channelId: channel.id,
    type: type,
    status: "open",
    claimedBy: null,
    openedAt: Date.now()
  });

  const embed = new EmbedBuilder()
    .setColor("#2b2d31")
    .setTitle(`🎫 تذكرة رقم #${ticketNumber}`)
    .setDescription(
      `مرحبًا <@${user.id}>، شكرًا لفتح التذكرة.\nسيتم الرد عليك قريبًا من قبل فريق الدعم.`
    )
    .setFooter({ text: "Esro Ticket System" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("call_user")
      .setLabel("استدعاء العميل")
      .setEmoji("📩")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("call_owner")
      .setLabel("استدعاء الأونر")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel("استلام")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("إغلاق")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@${user.id}> | <@&${staffRoleId}>`,
    embeds: [embed],
    components: [row]
  });

  interaction.reply({
    content: `تم فتح تذكرتك: ${channel}`,
    ephemeral: true
  });
});
// فتح التذكرة عند اختيار النوع
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (interaction.customId !== "ticket_type") return;

  const type = interaction.values[0];
  const user = interaction.user;

  if (userHasOpenTicket(user.id, type)) {
    return interaction.reply({
      content: "⚠️ لديك تذكرة مفتوحة من نفس النوع.",
      ephemeral: true
    });
  }

  const ticketNumber = getNextTicketNumber();

  const channel = await interaction.guild.channels.create({
    name: `ticket-${ticketNumber}`,
    type: ChannelType.GuildText,
    permissionOverwrites: [
      {
        id: interaction.guild.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      },
      {
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      }
    ]
  });

  addTicketRecord({
    number: ticketNumber,
    userId: user.id,
    channelId: channel.id,
    type,
    status: "open",
    claimedBy: null,
    openedAt: Date.now()
  });

  const embed = new EmbedBuilder()
    .setColor("#2b2d31")
    .setTitle(`🎫 تذكرة رقم #${ticketNumber}`)
    .setDescription(
      `مرحبًا <@${user.id}>، تم فتح تذكرتك.\n\nالرجاء انتظار أحد أعضاء الدعم.`
    )
    .setFooter({ text: "Esro Ticket System" });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("call_user")
      .setLabel("استدعاء العميل")
      .setEmoji("📩")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("call_owner")
      .setLabel("استدعاء الأونر")
      .setEmoji("👑")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel("استلام")
      .setEmoji("🛠️")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("إغلاق")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({ content: `<@${user.id}>`, embeds: [embed], components: [row] });

  interaction.reply({
    content: `تم فتح تذكرتك: <#${channel.id}>`,
    ephemeral: true
  });
});
// توليد الترانسكريبت HTML
async function generateTranscript(channel, ticketData) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const sorted = messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const botAvatar = channel.client.user.displayAvatarURL();

  let html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <title>Transcript Ticket #${ticketData.number}</title>
    <style>
      body {
        background-color: #1e1e1e;
        color: white;
        font-family: Arial;
        padding: 20px;
      }
      .header {
        text-align: center;
        margin-bottom: 30px;
      }
      .header img {
        width: 90px;
        border-radius: 50%;
      }
      .msg {
        background: #2b2d31;
        padding: 10px;
        margin: 10px 0;
        border-radius: 6px;
      }
      .author {
        font-weight: bold;
        color: #4ea1ff;
      }
      .staff {
        color: #4eff8a;
      }
      .time {
        font-size: 12px;
        opacity: 0.7;
      }
      img.thumbnail {
        width: 200px;
        border-radius: 6px;
        cursor: zoom-in;
      }
      .full {
        width: 100%;
      }
    </style>
    <script>
      function zoom(img) {
        if (img.classList.contains("thumbnail")) {
          img.classList.remove("thumbnail");
          img.classList.add("full");
        } else {
          img.classList.remove("full");
          img.classList.add("thumbnail");
        }
      }
    </script>
  </head>
  <body>

    <div class="header">
      <img src="${botAvatar}">
      <h1>Esro Ticket — Transcript</h1>
      <h2>Ticket #${ticketData.number}</h2>
      <p>Opened: ${new Date(ticketData.openedAt).toLocaleString()}</p>
      <p>Closed: ${new Date().toLocaleString()}</p>
      <hr>
    </div>
  `;

  sorted.forEach((msg) => {
    const isStaff = msg.member?.roles.cache.has(staffRoleId);
    const authorColor = isStaff ? "staff" : "author";

    html += `
      <div class="msg">
        <div class="${authorColor}">${msg.author.tag}</div>
        <div class="time">${new Date(msg.createdTimestamp).toLocaleString()}</div>
        <div>${msg.content || ""}</div>
    `;

    if (msg.attachments.size > 0) {
      msg.attachments.forEach((att) => {
        if (att.contentType?.startsWith("image/")) {
          html += `<img src="${att.url}" class="thumbnail" onclick="zoom(this)">`;
        }
      });
    }

    html += `</div>`;
  });

  html += `</body></html>`;

  return html;
}

// التعامل مع أزرار التذكرة
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const channel = interaction.channel;

  // استدعاء العميل
  if (interaction.customId === "call_user") {
    const ticket = loadTickets().tickets.find((t) => t.channelId === channel.id);
    const user = await client.users.fetch(ticket.userId);

    user.send(`📩 تم استدعاؤك إلى تذكرتك رقم #${ticket.number}.`).catch(() => {});
    return interaction.reply({ content: "تم استدعاء العميل.", ephemeral: true });
  }

  // استدعاء الأونر
  if (interaction.customId === "call_owner") {
    const owner = await client.users.fetch(ownerId);
    owner.send(`👑 تم استدعاؤك إلى التذكرة: <#${channel.id}>`).catch(() => {});
    return interaction.reply({ content: "تم استدعاء الأونر.", ephemeral: true });
  }

  // استلام التذكرة
  if (interaction.customId === "claim_ticket") {
    const data = loadTickets();
    const ticket = data.tickets.find((t) => t.channelId === channel.id);

    if (ticket.claimedBy)
      return interaction.reply({ content: "التذكرة مستلمة بالفعل.", ephemeral: true });

    ticket.claimedBy = interaction.user.id;
    saveTickets(data);

    return interaction.reply({
      content: `🛠️ تم استلام التذكرة بواسطة <@${interaction.user.id}>`,
      ephemeral: false
    });
  }

  // إغلاق التذكرة + إنشاء الترانسكريبت
  if (interaction.customId === "close_ticket") {
    const ticket = closeTicketRecord(channel.id);

    const html = await generateTranscript(channel, ticket);
    const fileName = `مشاهدة التذكرة #${ticket.number}.html`;

    fs.writeFileSync(fileName, html);

    const user = await client.users.fetch(ticket.userId);
    user.send({
      content: `📄 تم إغلاق تذكرتك.\nهذا هو الترانسكريبت الخاص بك:`,
      files: [fileName]
    }).catch(() => {});

    const logs = client.channels.cache.get(logsChannelId);
    logs.send({
      content: `📄 تم حفظ ترانسكريبت التذكرة #${ticket.number}`,
      files: [fileName]
    });

    setTimeout(() => {
      channel.delete().catch(() => {});
      fs.unlinkSync(fileName);
    }, 5000);

    interaction.reply({ content: "🔒 تم إغلاق التذكرة.", ephemeral: true });
  }
});

client.login(process.env.TOKEN):


|||||||||#Esro Store ||||||||