require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ChannelType,
} = require("discord.js");

const PREFIX = "d";
const COLOR = 0x9b59ff;
const DATA_FILE = path.join(__dirname, "data.json");

const bot = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// ===== LƯU DỮ LIỆU =====
let data = { users: {}, guilds: {}, tickets: {} };

if (fs.existsSync(DATA_FILE)) {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    console.log("Không đọc được data.json, bot sẽ tạo dữ liệu mới.");
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getUser(userId) {
  if (!data.users[userId]) {
    data.users[userId] = {
      coins: 500,
      xp: 0,
      lastDaily: 0,
      lastXp: 0,
      warnings: [],
    };
    saveData();
  }
  return data.users[userId];
}

function getGuild(guildId) {
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = {
      bannedWords: [],
      autoRoleId: null,
      logChannelId: null,
    };
    saveData();
  }
  return data.guilds[guildId];
}

function makeEmbed(title, description, color = COLOR) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function isOwner(message) {
  return message.author.id === message.guild.ownerId;
}

function getLevel(xp) {
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function parseTime(input) {
  const match = /^(\d+)(m|h|d)$/i.exec(input || "");
  if (!match) return null;

  const number = Number(match[1]);
  const unit = match[2].toLowerCase();

  if (unit === "m") return number * 60 * 1000;
  if (unit === "h") return number * 60 * 60 * 1000;
  if (unit === "d") return number * 24 * 60 * 60 * 1000;
}

async function sendLog(guild, text) {
  const guildData = getGuild(guild.id);
  const channel = guild.channels.cache.get(guildData.logChannelId);

  if (channel?.isTextBased()) {
    await channel.send({ embeds: [makeEmbed("📋 SERVER LOG", text, 0x64748b)] }).catch(() => {});
  }
}

function addXp(message) {
  const user = getUser(message.author.id);
  const now = Date.now();

  if (now - user.lastXp < 60_000) return;

  const oldLevel = getLevel(user.xp);
  user.xp += Math.floor(Math.random() * 6) + 5;
  user.lastXp = now;

  const newLevel = getLevel(user.xp);
  saveData();

  if (newLevel > oldLevel) {
    message.channel.send(
      `🎉 ${message.author} đã lên **Level ${newLevel}**!`
    ).catch(() => {});
  }
}

// ===== BOT ONLINE =====
bot.once("clientReady", () => {
  console.log(`✅ Bot đã chạy: ${bot.user.tag}`);
});

// ===== VÀO / RỜI SERVER =====
bot.on("guildMemberAdd", async (member) => {
  const guildData = getGuild(member.guild.id);

  if (guildData.autoRoleId) {
    const role = member.guild.roles.cache.get(guildData.autoRoleId);
    if (role?.editable) {
      await member.roles.add(role).catch(() => {});
    }
  }

  if (member.guild.systemChannel) {
    await member.guild.systemChannel.send({
      embeds: [
        makeEmbed(
          "🎉 Thành viên mới",
          `Chào mừng ${member} đến với **${member.guild.name}**!\nDùng \`${PREFIX}help\` để xem lệnh.`
        ),
      ],
    }).catch(() => {});
  }

  sendLog(member.guild, `📥 ${member.user.tag} đã vào server.`);
});

bot.on("guildMemberRemove", (member) => {
  sendLog(member.guild, `📤 ${member.user.tag} đã rời server.`);
});

bot.on("messageDelete", (message) => {
  if (!message.guild || !message.author?.bot) {
    if (message.guild && message.author) {
      sendLog(message.guild, `🗑️ Tin nhắn của **${message.author.tag}** đã bị xóa.`);
    }
  }
});

// ===== TIN NHẮN =====
bot.on("messageCreate", async (message) => {
  if (message.author.bot || !message.guild) return;

  const guildData = getGuild(message.guild.id);
  const content = message.content.toLowerCase();

  // Chặn từ cấm
  const foundWord = guildData.bannedWords.find((word) => content.includes(word.toLowerCase()));
  if (foundWord && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    await message.delete().catch(() => {});
    const warning = await message.channel.send(
      `🚫 ${message.author}, tin nhắn có từ không được phép.`
    ).catch(() => null);

    if (warning) setTimeout(() => warning.delete().catch(() => {}), 4000);
    return;
  }

  // Chống spam: 6 tin trong 8 giây
  const user = getUser(message.author.id);
  const now = Date.now();
  user.spamTimes = (user.spamTimes || []).filter((time) => now - time < 8000);
  user.spamTimes.push(now);

  if (user.spamTimes.length >= 6 && !message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    user.spamTimes = [];
    saveData();

    await message.delete().catch(() => {});
    await message.member.timeout(5 * 60 * 1000, "Spam").catch(() => {});

    return message.channel.send(
      `⚠️ ${message.author} đã bị hạn chế chat 5 phút vì spam.`
    );
  }

  addXp(message);

  if (!content.startsWith(PREFIX)) return;

  const args = message.content.trim().split(/\s+/);
  const command = args.shift().toLowerCase();

  try {
    // ===== HELP =====
    if (command === `${PREFIX}help`) {
      const help = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle("🤖 ZORIN BOT — BẢNG LỆNH")
        .setDescription(`Tiền tố: \`${PREFIX}\` • Coin chỉ là tiền ảo trong bot`)
        .addFields(
          {
            name: "🌟 Cơ bản",
            value:
              `\`${PREFIX}ping\` — Kiểm tra bot\n` +
              `\`${PREFIX}avatar [@user]\` — Xem avatar\n` +
              `\`${PREFIX}userinfo [@user]\` — Xem thành viên\n` +
              `\`${PREFIX}server\` — Thông tin server\n` +
              `\`${PREFIX}help\` — Bảng lệnh`,
          },
          {
            name: "💰 Coin & Level",
            value:
              `\`${PREFIX}daily\` — Nhận 500 coin/ngày\n` +
              `\`${PREFIX}bal [@user]\` — Xem coin\n` +
              `\`${PREFIX}chuyen @user số_coin\` — Chuyển coin\n` +
              `\`${PREFIX}topcoin\` — Top coin\n` +
              `\`${PREFIX}level [@user]\` — Xem level\n` +
              `\`${PREFIX}topxp\` — Top XP`,
          },
          {
            name: "🎮 Mini game",
            value:
              `\`${PREFIX}tx tai|xiu số_coin\`\n` +
              `\`${PREFIX}baucua bau|cua|tom|ca|ga|nai số_coin\`\n` +
              `\`${PREFIX}keobuabao bua|keo|bao\`\n` +
              `\`${PREFIX}coin ngua|sap\`\n` +
              `\`${PREFIX}so 1-10\`\n` +
              `\`${PREFIX}8ball câu_hỏi\`\n` +
              `\`${PREFIX}ship @user @user\``,
          },
          {
            name: "📢 Tiện ích",
            value:
              `\`${PREFIX}moi\` — Link mời 1 lần\n` +
              `\`${PREFIX}thongbao nội_dung\`\n` +
              `\`${PREFIX}say nội_dung\`\n` +
              `\`${PREFIX}poll câu_hỏi | lựa_chọn_1 | lựa_chọn_2\`\n` +
              `\`${PREFIX}giveaway 10m phần_thưởng\`\n` +
              `\`${PREFIX}ticket\` — Tạo ticket`,
          },
          {
            name: "🛡️ Quản lý",
            value:
              `\`${PREFIX}xoaso 1-100\`\n` +
              `\`${PREFIX}kick @user [lý_do]\`\n` +
              `\`${PREFIX}ban @user [lý_do]\`\n` +
              `\`${PREFIX}mute @user số_phút\`\n` +
              `\`${PREFIX}warn @user lý_do\`\n` +
              `\`${PREFIX}warnings @user\`\n` +
              `\`${PREFIX}lock\` / \`${PREFIX}unlock\` / \`${PREFIX}slow 10\`\n` +
              `\`${PREFIX}drole @user @role\` / \`${PREFIX}unrole @user @role\``,
          },
          {
            name: "👑 Chỉ chủ server",
            value:
              `\`${PREFIX}addcoin @user số_coin\`\n` +
              `\`${PREFIX}removecoin @user số_coin\`\n` +
              `\`${PREFIX}setcoin @user số_coin\`\n` +
              `\`${PREFIX}autorole @role\`\n` +
              `\`${PREFIX}setlog #kênh\`\n` +
              `\`${PREFIX}word add|remove|list từ_cấm\``,
          }
        )
        .setFooter({ text: "Bot cần được cấp quyền phù hợp trong server." })
        .setTimestamp();

      return message.reply({ embeds: [help] });
    }

    // ===== THÔNG TIN =====
    if (command === `${PREFIX}ping`) {
      return message.reply({
        embeds: [makeEmbed("🏓 Pong!", `Độ trễ: **${bot.ws.ping}ms**`, 0x22c55e)],
      });
    }

    if (command === `${PREFIX}avatar`) {
      const target = message.mentions.users.first() || message.author;
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(`🖼️ Avatar của ${target.username}`)
            .setImage(target.displayAvatarURL({ size: 1024 }))
            .setTimestamp(),
        ],
      });
    }

    if (command === `${PREFIX}userinfo`) {
      const target = message.mentions.members.first() || message.member;
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(`👤 ${target.user.username}`)
            .setThumbnail(target.user.displayAvatarURL())
            .addFields(
              { name: "Tên", value: target.user.tag, inline: true },
              { name: "ID", value: target.id, inline: true },
              { name: "Vào server", value: `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`, inline: true }
            )
            .setTimestamp(),
        ],
      });
    }

    if (command === `${PREFIX}server`) {
      const guild = message.guild;
      return message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR)
            .setTitle(`🏠 ${guild.name}`)
            .setThumbnail(guild.iconURL({ size: 512 }))
            .addFields(
              { name: "Chủ server", value: `<@${guild.ownerId}>`, inline: true },
              { name: "Thành viên", value: String(guild.memberCount), inline: true },
              { name: "ID", value: guild.id, inline: true }
            )
            .setTimestamp(),
        ],
      });
    }

    // ===== COIN =====
    if (command === `${PREFIX}daily`) {
      const profile = getUser(message.author.id);
      const cooldown = 24 * 60 * 60 * 1000;
      const remaining = cooldown - (Date.now() - profile.lastDaily);

      if (remaining > 0) {
        const hours = Math.floor(remaining / 3_600_000);
        const minutes = Math.floor((remaining % 3_600_000) / 60_000);
        return message.reply(`⏳ Bạn nhận daily lại sau **${hours} giờ ${minutes} phút**.`);
      }

      profile.coins += 500;
      profile.lastDaily = Date.now();
      saveData();

      return message.reply(`🎁 Bạn đã nhận **500 coin**! Số dư: **${profile.coins} coin**.`);
    }

    if (command === `${PREFIX}bal`) {
      const target = message.mentions.users.first() || message.author;
      const profile = getUser(target.id);

      return message.reply({
        embeds: [makeEmbed("💰 SỐ DƯ", `**${target.username}** đang có **${profile.coins.toLocaleString()} coin**.`)],
      });
    }

    if (command === `${PREFIX}chuyen`) {
      const target = message.mentions.users.first();
      const amount = Number(args[1]);
      const sender = getUser(message.author.id);

      if (!target || target.bot || target.id === message.author.id || !Number.isInteger(amount) || amount <= 0) {
        return message.reply(`Dùng: \`${PREFIX}chuyen @user số_coin\``);
      }

      if (sender.coins < amount) {
        return message.reply("❌ Bạn không đủ coin.");
      }

      sender.coins -= amount;
      getUser(target.id).coins += amount;
      saveData();

      return message.reply(`✅ Đã chuyển **${amount} coin** cho ${target}.`);
    }

    if (command === `${PREFIX}topcoin` || command === `${PREFIX}topxp`) {
      const type = command === `${PREFIX}topcoin` ? "coins" : "xp";
      const list = Object.entries(data.users)
        .sort((a, b) => b[1][type] - a[1][type])
        .slice(0, 10);

      const text = list.length
        ? list.map(([id, profile], index) => {
            const value = type === "coins"
              ? `${profile.coins.toLocaleString()} coin`
              : `${profile.xp} XP • Level ${getLevel(profile.xp)}`;
            return `**${index + 1}.** <@${id}> — ${value}`;
          }).join("\n")
        : "Chưa có dữ liệu.";

      return message.reply({
        embeds: [makeEmbed(type === "coins" ? "🏆 TOP COIN" : "🏆 TOP XP", text, 0xf59e0b)],
      });
    }

    if (command === `${PREFIX}level`) {
      const target = message.mentions.users.first() || message.author;
      const profile = getUser(target.id);

      return message.reply({
        embeds: [
          makeEmbed(
            "✨ LEVEL",
            `${target} đang ở **Level ${getLevel(profile.xp)}**\nXP hiện tại: **${profile.xp}**`
          ),
        ],
      });
    }

    // ===== GAME =====
    if (command === `${PREFIX}tx`) {
      const choice = args[0]?.toLowerCase();
      const bet = Number(args[1]);
      const profile = getUser(message.author.id);

      if (!["tai", "xiu"].includes(choice) || !Number.isInteger(bet) || bet < 10) {
        return message.reply(`Dùng: \`${PREFIX}tx tai|xiu số_coin\` • Cược ít nhất 10 coin.`);
      }

      if (profile.coins < bet) return message.reply("❌ Bạn không đủ coin.");

      const dice = [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ];

      const total = dice.reduce((a, b) => a + b, 0);
      const triple = dice[0] === dice[1] && dice[1] === dice[2];
      const result = triple ? "bộ ba" : total >= 11 ? "tai" : "xiu";
      const win = choice === result;

      profile.coins += win ? bet : -bet;
      saveData();

      return message.channel.send({
        embeds: [
          makeEmbed(
            "🎲 TÀI XỈU",
            `Xúc xắc: **${dice.join(" — ")}**\nTổng: **${total}** → **${result.toUpperCase()}**\n\n` +
            `${win ? `🎉 Thắng **${bet} coin**!` : `❌ Thua **${bet} coin**!`}\n` +
            `Số dư: **${profile.coins} coin**`,
            win ? 0x22c55e : 0xef4444
          ),
        ],
      });
    }

    if (command === `${PREFIX}baucua`) {
      const choice = args[0]?.toLowerCase();
      const bet = Number(args[1]);
      const profile = getUser(message.author.id);
      const animals = ["bau", "cua", "tom", "ca", "ga", "nai"];
      const icons = { bau: "🍈", cua: "🦀", tom: "🦐", ca: "🐟", ga: "🐓", nai: "🦌" };

      if (!animals.includes(choice) || !Number.isInteger(bet) || bet < 10) {
        return message.reply(`Dùng: \`${PREFIX}baucua bau|cua|tom|ca|ga|nai số_coin\``);
      }

      if (profile.coins < bet) return message.reply("❌ Bạn không đủ coin.");

      const result = Array.from({ length: 3 }, () => animals[Math.floor(Math.random() * animals.length)]);
      const count = result.filter((animal) => animal === choice).length;

      profile.coins -= bet;
      if (count > 0) profile.coins += bet * (count + 1);
      saveData();

      return message.channel.send({
        embeds: [
          makeEmbed(
            "🎲 BẦU CUA",
            `Kết quả: ${result.map((animal) => icons[animal]).join("  ")}\n` +
            `Bạn chọn: ${icons[choice]} **${choice.toUpperCase()}**\n\n` +
            `${count > 0 ? `🎉 Trúng **${count} lần**!` : "❌ Không trúng!"}\n` +
            `Số dư: **${profile.coins} coin**`,
            count > 0 ? 0x22c55e : 0xef4444
          ),
        ],
      });
    }

    if (command === `${PREFIX}keobuabao`) {
      const choice = args[0]?.toLowerCase();
      const choices = ["bua", "keo", "bao"];
      const icons = { bua: "👊", keo: "✌️", bao: "✋" };

      if (!choices.includes(choice)) {
        return message.reply(`Dùng: \`${PREFIX}keobuabao bua|keo|bao\``);
      }

      const botChoice = choices[Math.floor(Math.random() * choices.length)];
      const win =
        (choice === "bua" && botChoice === "keo") ||
        (choice === "keo" && botChoice === "bao") ||
        (choice === "bao" && botChoice === "bua");

      const result = choice === botChoice ? "🤝 Hòa!" : win ? "🎉 Bạn thắng!" : "❌ Bạn thua!";
      return message.reply(`${icons[choice]} vs ${icons[botChoice]}\n${result}`);
    }

    if (command === `${PREFIX}coin`) {
      const choice = args[0]?.toLowerCase();
      if (!["ngua", "sap"].includes(choice)) {
        return message.reply(`Dùng: \`${PREFIX}coin ngua|sap\``);
      }

      const result = Math.random() < 0.5 ? "ngua" : "sap";
      return message.reply(`🪙 Kết quả: **${result.toUpperCase()}** — ${choice === result ? "🎉 Bạn đúng!" : "❌ Bạn sai!"}`);
    }

    if (command === `${PREFIX}so`) {
      const guess = Number(args[0]);
      if (!Number.isInteger(guess) || guess < 1 || guess > 10) {
        return message.reply(`Dùng: \`${PREFIX}so 1-10\``);
      }

      const result = Math.floor(Math.random() * 10) + 1;
      return message.reply(`🎯 Số là **${result}** — ${guess === result ? "🎉 Bạn đoán đúng!" : "❌ Chưa đúng!"}`);
    }

    if (command === `${PREFIX}8ball`) {
      const question = args.join(" ");
      if (!question) return message.reply(`Dùng: \`${PREFIX}8ball câu_hỏi\``);

      const answers = [
        "✅ Chắc chắn rồi.",
        "🌟 Dấu hiệu tốt đó.",
        "🤔 Khó nói lắm.",
        "⏳ Hỏi lại sau nhé.",
        "❌ Không nên đâu.",
        "😂 Bot không biết.",
      ];

      return message.reply(`🎱 **${answers[Math.floor(Math.random() * answers.length)]}**`);
    }

    if (command === `${PREFIX}ship`) {
      const first = message.mentions.users.first();
      const second = message.mentions.users.at(1);

      if (!first || !second) {
        return message.reply(`Dùng: \`${PREFIX}ship @user1 @user2\``);
      }

      const percent = Math.floor(Math.random() * 101);
      return message.reply(`💘 Độ hợp của ${first} và ${second}: **${percent}%**`);
    }

    // ===== TIỆN ÍCH =====
    if (command === `${PREFIX}moi`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply("❌ Bạn không có quyền tạo link mời.");
      }

      const invite = await message.channel.createInvite({
        maxAge: 3600,
        maxUses: 1,
        unique: true,
      });

      return message.reply({
        embeds: [makeEmbed("🔗 LINK MỜI", `https://discord.gg/${invite.code}\nDùng 1 lần • hết hạn sau 1 giờ`, 0x22c55e)],
      });
    }

    if (command === `${PREFIX}thongbao`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply("❌ Bạn không có quyền gửi thông báo.");
      }

      const text = args.join(" ");
      if (!text) return message.reply(`Dùng: \`${PREFIX}thongbao nội_dung\``);

      return message.channel.send({ embeds: [makeEmbed("📢 THÔNG BÁO", text, 0xf59e0b)] });
    }

    if (command === `${PREFIX}say`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("❌ Bạn không có quyền dùng lệnh này.");
      }

      const text = args.join(" ");
      if (!text) return message.reply(`Dùng: \`${PREFIX}say nội_dung\``);

      await message.delete().catch(() => {});
      return message.channel.send(text);
    }

    if (command === `${PREFIX}poll`) {
      const parts = message.content.slice(command.length).split("|").map((part) => part.trim()).filter(Boolean);

      if (parts.length < 3 || parts.length > 6) {
        return message.reply(`Dùng: \`${PREFIX}poll câu_hỏi | lựa_chọn_1 | lựa_chọn_2\``);
      }

      const question = parts.shift();
      const numberIcons = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
      const options = parts.map((option, index) => `${numberIcons[index]} ${option}`).join("\n");

      const poll = await message.channel.send({
        embeds: [makeEmbed("📊 BÌNH CHỌN", `**${question}**\n\n${options}`, 0x38bdf8)],
      });

      for (let i = 0; i < parts.length; i++) {
        await poll.react(numberIcons[i]);
      }
      return;
    }

    if (command === `${PREFIX}giveaway`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
        return message.reply("❌ Bạn không có quyền tạo giveaway.");
      }

      const duration = parseTime(args[0]);
      const prize = args.slice(1).join(" ");

      if (!duration || !prize) {
        return message.reply(`Dùng: \`${PREFIX}giveaway 10m phần_thưởng\`\nThời gian: m, h hoặc d.`);
      }

      const giveaway = await message.channel.send({
        embeds: [
          makeEmbed(
            "🎉 GIVEAWAY",
            `Phần thưởng: **${prize}**\nKết thúc: <t:${Math.floor((Date.now() + duration) / 1000)}:R>\n\nBấm 🎉 để tham gia!`,
            0xf59e0b
          ),
        ],
      });

      await giveaway.react("🎉");

      setTimeout(async () => {
        const updated = await message.channel.messages.fetch(giveaway.id).catch(() => null);
        const reaction = updated?.reactions.cache.get("🎉");
        const users = await reaction?.users.fetch().catch(() => null);

        if (!users) return;

        users.delete(bot.user.id);
        const entrants = [...users.values()];

        if (!entrants.length) {
          return message.channel.send(`🎉 Giveaway **${prize}** kết thúc nhưng không có người tham gia.`);
        }

        const winner = entrants[Math.floor(Math.random() * entrants.length)];
        return message.channel.send(`🎉 Chúc mừng ${winner}! Bạn đã thắng **${prize}**.`);
      }, duration);

      return;
    }

    if (command === `${PREFIX}ticket`) {
      const existing = Object.entries(data.tickets).find(([, ticket]) =>
        ticket.ownerId === message.author.id && ticket.guildId === message.guild.id
      );

      if (existing) {
        return message.reply(`❌ Bạn đã có ticket: <#${existing[0]}>`);
      }

      const channel = await message.guild.channels.create({
        name: `ticket-${message.author.username}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: message.guild.roles.everyone.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: message.author.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: bot.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
        ],
      });

      data.tickets[channel.id] = {
        ownerId: message.author.id,
        guildId: message.guild.id,
      };
      saveData();

      await channel.send({
        embeds: [
          makeEmbed(
            "🎫 TICKET HỖ TRỢ",
            `${message.author}, hãy mô tả vấn đề của bạn.\nDùng \`${PREFIX}close\` để đóng ticket.`
          ),
        ],
      });

      return message.reply(`✅ Đã tạo ticket: ${channel}`);
    }

    if (command === `${PREFIX}close`) {
      const ticket = data.tickets[message.channel.id];

      if (!ticket) return message.reply("❌ Đây không phải ticket.");
      if (ticket.ownerId !== message.author.id && !message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("❌ Bạn không có quyền đóng ticket này.");
      }

      await message.channel.send("🔒 Ticket sẽ đóng sau 3 giây.");
      delete data.tickets[message.channel.id];
      saveData();

      return setTimeout(() => message.channel.delete().catch(() => {}), 3000);
    }

    // ===== MOD =====
    if (command === `${PREFIX}xoaso`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
        return message.reply("❌ Bạn không có quyền xóa tin nhắn.");
      }

      const amount = Number(args[0]);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        return message.reply(`Dùng: \`${PREFIX}xoaso 1-100\``);
      }

      await message.channel.bulkDelete(amount, true);
      const sent = await message.channel.send(`🗑️ Đã xóa **${amount}** tin nhắn.`);
      setTimeout(() => sent.delete().catch(() => {}), 3000);
      return;
    }

    if (command === `${PREFIX}kick` || command === `${PREFIX}ban`) {
      const isBan = command === `${PREFIX}ban`;
      const neededPermission = isBan
        ? PermissionsBitField.Flags.BanMembers
        : PermissionsBitField.Flags.KickMembers;

      if (!message.member.permissions.has(neededPermission)) {
        return message.reply("❌ Bạn không có quyền dùng lệnh này.");
      }

      const target = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do";

      if (!target || (isBan ? !target.bannable : !target.kickable)) {
        return message.reply(`❌ Không thể ${isBan ? "ban" : "kick"} người này.`);
      }

      if (isBan) {
        await target.ban({ reason });
      } else {
        await target.kick(reason);
      }

      sendLog(message.guild, `${isBan ? "🔨 Ban" : "👢 Kick"} **${target.user.tag}** • ${reason}`);
      return message.channel.send(`${isBan ? "🔨 Đã ban" : "👢 Đã kick"} **${target.user.tag}**.`);
    }

    if (command === `${PREFIX}mute`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("❌ Bạn không có quyền mute.");
      }

      const target = message.mentions.members.first();
      const minutes = Number(args[1]);

      if (!target || !target.moderatable || !Number.isInteger(minutes) || minutes < 1 || minutes > 40320) {
        return message.reply(`Dùng: \`${PREFIX}mute @user số_phút\``);
      }

      await target.timeout(minutes * 60 * 1000, "Mute bởi bot");
      return message.channel.send(`🔇 Đã mute **${target.user.tag}** trong **${minutes} phút**.`);
    }

    if (command === `${PREFIX}warn`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
        return message.reply("❌ Bạn không có quyền warn.");
      }

      const target = message.mentions.members.first();
      const reason = args.slice(1).join(" ") || "Không có lý do";

      if (!target) return message.reply(`Dùng: \`${PREFIX}warn @user lý_do\``);

      getUser(target.id).warnings.push({
        reason,
        moderator: message.author.id,
        date: Date.now(),
      });
      saveData();

      return message.channel.send(`⚠️ Đã warn ${target}. Lý do: **${reason}**`);
    }

    if (command === `${PREFIX}warnings`) {
      const target = message.mentions.users.first() || message.author;
      const warnings = getUser(target.id).warnings;

      if (!warnings.length) return message.reply(`${target} chưa có cảnh cáo nào. ✅`);

      const text = warnings
        .slice(-10)
        .map((warn, index) => `**${index + 1}.** ${warn.reason} • <@${warn.moderator}>`)
        .join("\n");

      return message.reply({
        embeds: [makeEmbed(`⚠️ WARNINGS — ${target.username}`, text, 0xf59e0b)],
      });
    }

    if (command === `${PREFIX}lock` || command === `${PREFIX}unlock`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("❌ Bạn không có quyền khóa kênh.");
      }

      const locked = command === `${PREFIX}lock`;
      await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, {
        SendMessages: !locked,
      });

      return message.channel.send(locked ? "🔒 Kênh đã bị khóa." : "🔓 Kênh đã được mở.");
    }

    if (command === `${PREFIX}slow`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
        return message.reply("❌ Bạn không có quyền chỉnh slowmode.");
      }

      const seconds = Number(args[0]);
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
        return message.reply(`Dùng: \`${PREFIX}slow 0-21600\``);
      }

      await message.channel.setRateLimitPerUser(seconds);
      return message.channel.send(`🐢 Slowmode đã đặt: **${seconds} giây**.`);
    }

    if (command === `${PREFIX}drole` || command === `${PREFIX}unrole`) {
      if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
        return message.reply("❌ Bạn không có quyền quản lý role.");
      }

      const target = message.mentions.members.first();
      const role = message.mentions.roles.first();

      if (!target || !role || !role.editable) {
        return message.reply(`Dùng: \`${PREFIX}${command === `${PREFIX}drole` ? "drole" : "unrole"} @user @role\``);
      }

      if (command === `${PREFIX}drole`) {
        await target.roles.add(role);
        return message.channel.send(`✅ Đã cấp ${role} cho ${target}.`);
      }

      await target.roles.remove(role);
      return message.channel.send(`✅ Đã gỡ ${role} khỏi ${target}.`);
    }

    // ===== CHỦ SERVER =====
    if (["addcoin", "removecoin", "setcoin"].includes(command.slice(PREFIX.length))) {
      if (!isOwner(message)) {
        return message.reply("❌ Chỉ chủ server mới dùng được lệnh coin này.");
      }

      const target = message.mentions.users.first();
      const amount = Number(args[1]);

      if (!target || !Number.isInteger(amount) || amount < 0) {
        return message.reply(`Dùng: \`${command} @user số_coin\``);
      }

      const profile = getUser(target.id);

      if (command === `${PREFIX}addcoin`) profile.coins += amount;
      if (command === `${PREFIX}removecoin`) profile.coins = Math.max(0, profile.coins - amount);
      if (command === `${PREFIX}setcoin`) profile.coins = amount;

      saveData();
      return message.channel.send(`👑 Đã cập nhật coin của ${target}: **${profile.coins} coin**.`);
    }

    if (command === `${PREFIX}autorole`) {
      if (!isOwner(message)) return message.reply("❌ Chỉ chủ server mới dùng được.");

      const role = message.mentions.roles.first();
      if (!role || !role.editable) return message.reply(`Dùng: \`${PREFIX}autorole @role\``);

      getGuild(message.guild.id).autoRoleId = role.id;
      saveData();

      return message.reply(`✅ Thành viên mới sẽ tự nhận role ${role}.`);
    }

    if (command === `${PREFIX}setlog`) {
      if (!isOwner(message)) return message.reply("❌ Chỉ chủ server mới dùng được.");

      const channel = message.mentions.channels.first();
      if (!channel?.isTextBased()) return message.reply(`Dùng: \`${PREFIX}setlog #kênh\``);

      getGuild(message.guild.id).logChannelId = channel.id;
      saveData();

      return message.reply(`✅ Log server sẽ gửi vào ${channel}.`);
    }

    if (command === `${PREFIX}word`) {
      if (!isOwner(message)) return message.reply("❌ Chỉ chủ server mới dùng được.");

      const action = args[0]?.toLowerCase();
      const word = args.slice(1).join(" ").toLowerCase();
      const words = getGuild(message.guild.id).bannedWords;

      if (action === "list") {
        return message.reply(words.length ? `🚫 Từ cấm: ${words.join(", ")}` : "Chưa có từ cấm.");
      }

      if (!word || !["add", "remove"].includes(action)) {
        return message.reply(`Dùng: \`${PREFIX}word add từ_cấm\`, \`${PREFIX}word remove từ_cấm\`, hoặc \`${PREFIX}word list\``);
      }

      if (action === "add" && !words.includes(word)) words.push(word);
      if (action === "remove") {
        getGuild(message.guild.id).bannedWords = words.filter((item) => item !== word);
      }

      saveData();
      return message.reply(`✅ Đã cập nhật danh sách từ cấm.`);
    }
  } catch (error) {
    console.error(error);
    return message.reply("❌ Có lỗi hoặc bot chưa được cấp đủ quyền.");
  }
});
// ===== EXPRESS SERVER ĐỂ RENDER NHẬN PORT =====
const express = require("express");
const app = express();
const port = process.env.PORT || 4000;

app.get("/", (req, res) => {
  res.send("Zorin Bot is running!");
});

app.listen(port, () => {
  console.log(`🌐 Web server đang chạy trên cổng ${port}`);
});

bot.login(process.env.TOKEN);