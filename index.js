const { Client, GatewayIntentBits, PermissionFlagsBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ChannelType, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const model = "claude-3.5-sonnet";
const API = "https://api.penguinai.tech/v1/chat/completions";

const DB_PATH = path.join(__dirname, 'db.json');
const reformQueue = new Map(); 

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('Error: BOT_TOKEN is missing from the environment variables.');
    process.exit(1);
}

async function initDB() {
    try {
        await fs.access(DB_PATH);
        const data = await fs.readFile(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch {
        const initialDB = {
            suggestions: {},
            contexts: {},
            channelWhitelists: {} 
        };
        await fs.writeFile(DB_PATH, JSON.stringify(initialDB, null, 2));
        return initialDB;
    }
}

async function saveDB(data) {
    await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2));
}

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages, 
        GatewayIntentBits.MessageContent  
    ] 
});

const commands = [
    {
        name: 'evaluate_server',
        description: 'Evaluate the server using AI.',
    },
    {
        name: 'reform',
        description: 'Admin only: Restructure the server with AI assistance.',
    },
    {
        name: 'delete_all',
        description: 'Bot owner only: Delete every channel, category, and role (used to test the bot).',
    },
    {
        name: 'add_suggestion',
        description: 'Admin only: Add a suggestion for server reforms',
        options: [{
            name: 'suggestion',
            type: 3,
            description: 'The suggestion to add',
            required: true
        }]
    },
    {
        name: 'remove_suggestion',
        description: 'Admin only: Remove a suggestion by ID',
        options: [{
            name: 'id',
            type: 3,
            description: 'The ID of the suggestion to remove',
            required: true
        }]
    },
    {
        name: 'list_suggestions',
        description: 'Admin only: List all current suggestions'
    },
    {
        name: 'set_context',
        description: 'Admin only: Set the AI context for this server',
        options: [{
            name: 'context',
            type: 3,
            description: 'The context to set (max 200 characters)',
            required: true
        }]
    },

    {
        name: 'whitelist_channel',
        description: 'Admin only: Add a channel to the AI reading whitelist',
        options: [{
            name: 'channel',
            type: 7,
            description: 'The channel to whitelist',
            required: true
        }]
    },
    {
        name: 'unwhitelist_channel',
        description: 'Admin only: Remove a channel from the AI reading whitelist',
        options: [{
            name: 'channel',
            type: 7,
            description: 'The channel to remove from whitelist',
            required: true
        }]
    },
    {
        name: 'list_whitelisted',
        description: 'Admin only: List all whitelisted channels'
    },
    {
        name: 'view_config',
        description: 'Admin only: View all server configurations'
    }
];

const helpCommand = {
    name: 'help',
    description: 'Shows information about all available commands',
};

commands.push(helpCommand);

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {

        const registeredCommands = await client.application.commands.set(commands);
        console.log('Global slash commands registered:', registeredCommands.map(cmd => cmd.name).join(', '));
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
});

async function evaluateServer(guild, interaction) {  
    const initialMessage = await interaction.reply({
        content: '🔍 Evaluating the server... Please wait.',
        ephemeral: false,
        fetchReply: true  
    });

    try {
        const db = await initDB();
        const context = db.contexts[guild.id] || '';
        const messageHistory = await getChannelHistory(guild);
        const response = await axios.post(API, {
            model: model,
            messages: [
                {
                    role: 'system',
                    content: `You're a Discord bot assisting a server named "${guild.name}". ${context}\n\nServer details: ${JSON.stringify(guild)}. Recent message history: ${JSON.stringify(messageHistory)}. Provide realistic, concise feedback as if you are observing server dynamics. No emojis or markdown. You can give a rating of 0 to 10 to the server. Make this rating realistic, and dependent on many different things.`,
                },
                {
                    role: 'user',
                    content: `Talk in this language: ${guild.preferredLocale}. Evaluate this server and suggest improvements. Keep it short and realistic.`,
                },
            ],
        });

        const aiResponse = response.data.choices[0]?.message?.content || 'No response from AI.';

        const evaluationEmbed = {
            color: 0x0099ff,
            title: 'Server Evaluation',
            description: aiResponse,
            timestamp: new Date(),
            footer: {
                text: `Evaluated for ${guild.name}`
            }
        };

        await interaction.editReply({
            content: '',
            embeds: [evaluationEmbed]
        });
    } catch (error) {
        console.error('Error during server evaluation:', error);
        await interaction.editReply({
            content: '❌ An error occurred while evaluating the server.',
            embeds: []
        });
    }
}

const confirmations = new Map();
const adminonly = ['reform', 'add_suggestion', 'remove_suggestion', 'list_suggestions', 'set_context', 
         'whitelist_channel', 'unwhitelist_channel', 'list_whitelisted', 'view_config'];

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, member, guild } = interaction;

    if (adminonly.includes(commandName)) {
        if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({
                content: '❌ You must be an administrator to use this command.',
                ephemeral: true
            });
        }
    }

    switch (commandName) {
		case 'help': {
    const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle('🤖 AIreform')
        .setDescription('An AI-powered bot that helps analyze and restructure Discord servers. **⚠️ WARNING: The reform feature is experimental and should only be tested in new servers. Never use it in existing servers without first testing in a separate server and creating a backup.**')
        .addFields(
            {
                name: '📊 Analysis Commands',
                value: '`/evaluate_server` - Analyzes your server using AI and provides feedback\n' +
                      '`/view_config` - 🔒 Admin only: View all server configurations including context, suggestions, and whitelisted channels'
            },
            {
                name: '🔄 Reform Commands',
                value: '`/reform` - 🔒 Admin only: Initiates an AI-powered server restructure (requires owner + admin approval)\n' +
                      '`/add_suggestion` - 🔒 Admin only: Add suggestions for the AI to consider during reform\n' +
                      '`/remove_suggestion` - 🔒 Admin only: Remove a specific suggestion by ID\n' +
                      '`/list_suggestions` - 🔒 Admin only: View all current reform suggestions'
            },
            {
                name: '⚙️ Configuration Commands',
                value: '`/set_context` - 🔒 Admin only: Set server context for AI (max 200 chars)\n' +
                      '`/whitelist_channel` - 🔒 Admin only: Add a channel to AI analysis whitelist (max 10)\n' +
                      '`/unwhitelist_channel` - 🔒 Admin only: Remove a channel from whitelist\n' +
                      '`/list_whitelisted` - 🔒 Admin only: View all whitelisted channels'
            },
            {
                name: '⚠️ Important Notes',
                value: '• The reform feature will lock all channels during restructuring\n' +
                      '• Server owner and at least half of admins must approve reforms\n' +
                      '• Always test reforms in a new server first\n' +
                      '• Create a backup before using reform features\n' +
                      '• The AI analyzes only whitelisted channels (max 10)\n' +
                      '• Each server can store up to 20 reform suggestions'
            },
            {
                name: '🔍 Message Analysis',
                value: 'The bot analyzes up to 50 recent messages from whitelisted channels to better understand server activity and provide more accurate recommendations.'
            }
        )
        .setFooter({ text: 'Created with <3 by genagana_gen1x (Gen1x)' });

    await interaction.reply({
        embeds: [embed],
        ephemeral: false
    });
    break;
}

        case 'delete_all': {
            if (interaction.user.id !== '1316841790367731773') {
                return interaction.reply({
                    content: '❌ You must be the bot owner to use this command.',
                    ephemeral: true,
                });
            }

            await interaction.reply({
                content: '⚠️ Nuking the server... Please wait.',
                ephemeral: false,
            });

            try {
                await nuke(guild, interaction.channel);
                await interaction.editReply('✅ Server has been nuked successfully.');
            } catch (error) {
                console.error('Error during nuking process:', error);
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('Error')
                    .setDescription('An error occurred while nuking the server. Please try again later.');

                await interaction.editReply({
                    content: null,
                    embeds: [errorEmbed],
                });
            }
            break;
        }

        case 'evaluate_server': {
            evaluateServer(guild, interaction);
			break;
        }

		case 'reform': {
            const admins = (await guild.members.fetch()).filter(m => m.permissions.has(PermissionsBitField.Flags.Administrator) && !m.user.bot);
            const owner = await guild.fetchOwner();

            if (admins.size === 1 && admins.has(owner.id)) {
                return handleReformConfirmation(interaction, guild, owner);
            }

            const totalAdmins = admins.size;

            if (!confirmations.has(guild.id)) {
                confirmations.set(guild.id, new Set());

                const embed = new EmbedBuilder()
                    .setColor(0xFFFF00)
                    .setTitle('Server Reform Warning')
                    .setDescription(`This action will lock all channels and restructure the server using AI. **BE *CAREFUL* THOUGH**, because this AI is experimental. You should not use this feature in existing servers, instead make a new one and experiment there before publishing it to a Discord template, and then port it over to your server. At least **half of the admins (${Math.ceil(totalAdmins / 2)})** and the **server owner** must approve the changes.`);

                const yesButton = new ButtonBuilder()
                    .setCustomId('confirm_reform')
                    .setLabel('Yes')
                    .setStyle(ButtonStyle.Success);

                const row = new ActionRowBuilder().addComponents(yesButton);

                const reformMessage = await interaction.reply({
                    embeds: [embed],
                    components: [row],
                    ephemeral: false,
                });

                const collector = reformMessage.createMessageComponentCollector({
                    filter: (buttonInteraction) => buttonInteraction.customId === 'confirm_reform' && (admins.has(buttonInteraction.user.id) || buttonInteraction.user.id === owner.id),
                    time: 60000,
                });

                collector.on('collect', (buttonInteraction) => {
                    confirmations.get(guild.id).add(buttonInteraction.user.id);
                    buttonInteraction.deferUpdate();

                    const confirmedAdmins = confirmations.get(guild.id);
                    if (confirmedAdmins.has(owner.id) && confirmedAdmins.size >= Math.ceil(totalAdmins / 2)) {
                        collector.stop('confirmed');
                    }
                });

                collector.on('end', async (_, reason) => {
                    if (reason === 'confirmed') {
                        await interaction.followUp('✅ Reform confirmed. Beginning server restructuring...');
                        await lockAllChannels(guild);
                        await reformServer(guild);
                    } else {
                        await interaction.followUp('❌ Reform not approved. Action cancelled.');
                    }

                    confirmations.delete(guild.id);
                });
            } else {
                return interaction.reply({
                    content: '⚠️ A reform process is already active for this server.',
                    ephemeral: true,
                });
            }
            break;
        }

        case 'add_suggestion': {
            const suggestion = interaction.options.getString('suggestion');
            const db = await initDB();

            if (!db.suggestions[guild.id]) {
                db.suggestions[guild.id] = [];
            }

            if (db.suggestions[guild.id].length >= 20) {
                db.suggestions[guild.id].shift();
            }

            db.suggestions[guild.id].push(suggestion);
            await saveDB(db);

            await interaction.reply({
                content: `✅ Suggestion added! (${db.suggestions[guild.id].length}/20)`,
                ephemeral: true
            });
            break;
        }

        case 'remove_suggestion': {
            const id = parseInt(interaction.options.getString('id')) - 1;
            const db = await initDB();

            if (!db.suggestions[guild.id] || !db.suggestions[guild.id][id]) {
                return interaction.reply({
                    content: '❌ Invalid suggestion ID.',
                    ephemeral: true
                });
            }

            db.suggestions[guild.id].splice(id, 1);
            await saveDB(db);

            await interaction.reply({
                content: '✅ Suggestion removed!',
                ephemeral: true
            });
            break;
        }

        case 'list_suggestions': {
            const db = await initDB();
            const suggestions = db.suggestions[guild.id] || [];

            if (suggestions.length === 0) {
                return interaction.reply({
                    content: 'No suggestions found.',
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('Server Reform Suggestions')
                .setDescription(suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n'));

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
            break;
        }

        case 'set_context': {
            const context = interaction.options.getString('context');

            if (context.length > 200) {
                return interaction.reply({
                    content: '❌ Context must be 200 characters or less.',
                    ephemeral: true
                });
            }

            const db = await initDB();
            db.contexts[guild.id] = context;
            await saveDB(db);

            await interaction.reply({
                content: '✅ Context set successfully!',
                ephemeral: true
            });
            break;
        }

		case 'whitelist_channel': {
            const channel = interaction.options.getChannel('channel');

            if (!channel.isTextBased()) {
                return interaction.reply({
                    content: '❌ Only text channels can be whitelisted.',
                    ephemeral: true
                });
            }

            const db = await initDB();
            if (!db.channelWhitelists[guild.id]) {
                db.channelWhitelists[guild.id] = [];
            }

            if (db.channelWhitelists[guild.id].length >= 10) {
                return interaction.reply({
                    content: '❌ Maximum of 10 whitelisted channels allowed.',
                    ephemeral: true
                });
            }

            if (db.channelWhitelists[guild.id].includes(channel.id)) {
                return interaction.reply({
                    content: '❌ This channel is already whitelisted.',
                    ephemeral: true
                });
            }

            db.channelWhitelists[guild.id].push(channel.id);
            await saveDB(db);

            await interaction.reply({
                content: `✅ Added ${channel.name} to whitelist! (${db.channelWhitelists[guild.id].length}/10)`,
                ephemeral: true
            });
            break;
        }

        case 'unwhitelist_channel': {
            const channel = interaction.options.getChannel('channel');
            const db = await initDB();

            if (!db.channelWhitelists[guild.id] || !db.channelWhitelists[guild.id].includes(channel.id)) {
                return interaction.reply({
                    content: '❌ This channel is not whitelisted.',
                    ephemeral: true
                });
            }

            db.channelWhitelists[guild.id] = db.channelWhitelists[guild.id].filter(id => id !== channel.id);
            await saveDB(db);

            await interaction.reply({
                content: `✅ Removed ${channel.name} from whitelist!`,
                ephemeral: true
            });
            break;
        }

        case 'list_whitelisted': {
            const db = await initDB();
            const whitelistedChannels = db.channelWhitelists[guild.id] || [];

            if (whitelistedChannels.length === 0) {
                return interaction.reply({
                    content: 'No channels are whitelisted.',
                    ephemeral: true
                });
            }

            const channelList = whitelistedChannels
                .map(id => guild.channels.cache.get(id))
                .filter(channel => channel) 
                .map(channel => channel.name)
                .join('\n');

            const embed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('Whitelisted Channels')
                .setDescription(channelList);

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
            break;
        }

        case 'view_config': {
            const db = await initDB();

            const context = db.contexts[guild.id] || 'No context set';
            const suggestions = db.suggestions[guild.id] || [];
            const whitelistedChannels = (db.channelWhitelists[guild.id] || [])
                .map(id => guild.channels.cache.get(id))
                .filter(channel => channel)
                .map(channel => channel.name);

            const embed = new EmbedBuilder()
                .setColor(0x00AE86)
                .setTitle('Server Configuration')
                .addFields(
                    { name: 'Context', value: context },
                    { name: 'Suggestions', value: suggestions.length > 0 ? suggestions.join('\n') : 'No suggestions' },
                    { name: 'Whitelisted Channels', value: whitelistedChannels.length > 0 ? whitelistedChannels.join('\n') : 'No channels whitelisted' }
                );

            await interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
            break;
        }
    }
});

async function getChannelHistory(guild) {
    const db = await initDB();
    const whitelistedChannels = db.channelWhitelists[guild.id] || [];
    let messageHistory = [];

    for (const channelId of whitelistedChannels) {
        const channel = guild.channels.cache.get(channelId);
        if (channel && channel.isTextBased()) {
            try {
                const messages = await channel.messages.fetch({ limit: 50 });
                const channelMessages = messages
                    .filter(msg => !msg.author.bot) 
                    .map(msg => ({
                        channel: channel.name,
                        author: msg.author.username,
                        content: msg.content,
                        timestamp: msg.createdTimestamp
                    }));
                messageHistory = messageHistory.concat(channelMessages);
            } catch (error) {
                console.error(`Error fetching messages from ${channel.name}:`, error);
            }
        }
    }

    messageHistory.sort((a, b) => b.timestamp - a.timestamp);
    return messageHistory.slice(0, 50);
}

async function nuke(guild, currentChannel) {

    const roles = guild.roles.cache.filter(role => role.id !== guild.id);
    for (const [roleId, role] of roles) {
        try {
            await role.delete();
            console.log(`Deleted role: ${role.name}`);
        } catch (error) {
            console.error(`Failed to delete role ${role.name}:`, error);
        }
    }

    const channels = guild.channels.cache.filter(channel => channel.id !== currentChannel.id);
    for (const [channelId, channel] of channels) {
        try {
            if (channel.isTextBased() || channel.isVoiceBased() || channel.type === ChannelType.GuildCategory) {
                await channel.delete();
                console.log(`Deleted ${channel.type === ChannelType.GuildCategory ? 'category' : 'channel'}: ${channel.name}`);
            }
        } catch (error) {
            console.error(`Failed to delete channel/category ${channel.name}:`, error);
        }
    }

    console.log('Server has been completely nuked except for the current channel.');
}

async function handleReformConfirmation(interaction, guild, owner) {
    const embed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('Server Reform Warning')
        .setDescription(`This action will lock all channels and restructure the server using AI. **BE *CAREFUL* THOUGH**, because this AI is experimental. You should not use this feature in existing servers, instead make a new one and experiment there before publishing it to a Discord template, and then port it over to your server. The **server owner** must approve the changes, as there are no administrators other than the owner.`);

    const yesButton = new ButtonBuilder()
        .setCustomId('confirm_reform')
        .setLabel('Yes')
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(yesButton);

    const reformMessage = await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true,
    });

    const collector = reformMessage.createMessageComponentCollector({
        filter: (buttonInteraction) => buttonInteraction.customId === 'confirm_reform' && buttonInteraction.user.id === owner.id,
        time: 60000,
    });

    collector.on('collect', async (buttonInteraction) => {
        await buttonInteraction.deferUpdate();
        collector.stop('confirmed');
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'confirmed') {
            await interaction.followUp('✅ Reform confirmed by the owner. Beginning server restructuring...');
            await lockAllChannels(guild);
            await reformServer(guild);
        } else {
            await interaction.followUp('❌ Reform not approved. Action cancelled.');
        }
    });
}

async function lockAllChannels(guild) {
    const channels = guild.channels.cache.filter(channel => channel.isTextBased());

    for (const [channelId, channel] of channels) {
        try {
            await channel.permissionOverwrites.edit(guild.roles.everyone, {
                SendMessages: false,
                AddReactions: false,
            });
        } catch (error) {
            console.error(`Failed to lock channel ${channel.name}:`, error);
        }
    }

    console.log('All channels locked.');
}

async function reformServer(guild) {

    if (reformQueue.has(guild.id)) {
        return;
    }

        const existingStructure = {
            roles: Array.from(guild.roles.cache.values()).map(role => ({
                name: role.name,
            })),
            categories: Array.from(guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).values())
                .map(category => ({
                    name: category.name,
                    id: category.id
                })),
            channels: Array.from(guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory).values())
                .map(channel => ({
                    name: channel.name,
                    type: channel.type === ChannelType.GuildVoice ? 'voice' : 'text',
                    category: channel.parent?.name,
                    description: channel.topic || ''
                }))
        };

		console.log(JSON.stringify(existingStructure));

    reformQueue.set(guild.id, Date.now());

    const queuePosition = Array.from(reformQueue.keys()).indexOf(guild.id);
    if (queuePosition > 0) {
        const waitTime = queuePosition * 180000; 
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    let statusChannel = null;

    try {

        statusChannel = await guild.channels.create({
            name: 'reform-status',
            type: ChannelType.GuildText,
            permissionOverwrites: [
                {
                    id: guild.roles.everyone.id,
                    deny: [PermissionFlagsBits.SendMessages],
                },
                {
                    id: client.user.id,
                    allow: [PermissionFlagsBits.SendMessages],
                }
            ]
        });

        await statusChannel.send('🚀 Beginning server reform process...');

        const db = await initDB();
        const suggestions = db.suggestions[guild.id] || [];
        const context = db.contexts[guild.id] || '';

        const response = await axios.post(API, {
    model: model,
    messages: [
	    {
            "role": "system",
            "content": "You are assisting in a server reform."
        },
        {
            "role": "system",
            "content": `CONTEXT: ${context}
			JSON example:
			{
  "roles": [
    {
      "name": "Server Admin",
      "permissions": ["Administrator"]
    },
    {
      "name": "Moderator",
      "permissions": [
        "ManageMessages",
        "KickMembers",
        "BanMembers",
        "ManageNicknames",
        "ViewAuditLog"
      ]
    },
    {
      "name": "Event Manager",
      "permissions": [
        "ManageEvents",
        "ManageThreads",
        "CreatePublicThreads",
        "CreatePrivateThreads"
      ]
    },
    {
      "name": "Regular Member",
      "permissions": [
        "ViewChannel",
        "SendMessages",
        "EmbedLinks",
        "AttachFiles",
        "AddReactions",
        "UseExternalEmojis"
      ]
    }
  ],
  "categories": [
    {
      "name": "INFORMATION"
    },
    {
      "name": "COMMUNITY"
    },
    {
      "name": "EVENTS"
    },
    {
      "name": "VOICE LOUNGES"
    }
  ],
  "channels": [
    {
      "name": "welcome",
      "type": "text",
      "category": "INFORMATION",
      "description": "Welcome to our server! Please read the rules.",
      "permissions": [
        {
          "role": "Regular Member",
          "permissions": {
            "SendMessages": false,
            "AddReactions": true
          }
        }
      ]
    },
    {
      "name": "rules",
      "type": "text",
      "category": "INFORMATION",
      "description": "Server rules and guidelines",
      "permissions": [
        {
          "role": "Regular Member",
          "permissions": {
            "SendMessages": false,
            "AddReactions": false
          }
        }
      ]
    },
    {
      "name": "announcements",
      "type": "text",
      "category": "INFORMATION",
      "description": "Important server announcements",
      "permissions": [
        {
          "role": "Regular Member",
          "permissions": {
            "SendMessages": false,
            "AddReactions": true
          }
        }
      ]
    },
    {
      "name": "general-chat",
      "type": "text",
      "category": "COMMUNITY",
      "description": "General discussion channel"
    },
    {
      "name": "memes",
      "type": "text",
      "category": "COMMUNITY",
      "description": "Share your favorite memes"
    },
    {
      "name": "event-planning",
      "type": "text",
      "category": "EVENTS",
      "description": "Plan and discuss upcoming events",
      "permissions": [
        {
          "role": "Event Manager",
          "permissions": {
            "ManageMessages": true,
            "MentionEveryone": true
          }
        }
      ]
    },
    {
      "name": "Gaming Lounge",
      "type": "voice",
      "category": "VOICE LOUNGES"
    },
    {
      "name": "Chill Zone",
      "type": "voice",
      "category": "VOICE LOUNGES"
    }
  ],
  "delete": [
    "old-announcements",
    "outdated-rules",
    "archived-chat"
  ]
}
			`
        },
        {
            "role": "system",
            "content": `${suggestions.length > 0 ? `Suggestions to implement (if empty, there's none):\n${suggestions.join('\\n')}\n\n` : ''}`
        },
        {
            "role": "system",
            "content": "Respond with valid JSON for new/modified structures only. Do not duplicate existing roles/channels unless modifications are needed. Perform a full reform, with lots of new changes. To give a role admin perms, include Administrator in the permissions array. Do NOT include text before or after the JSON, return the JSON alone, with no markdown. Do not ask questions."
        },
        {
            "role": "user",
            "content": `Restructure this server considering the structure I'll give you and the provided suggestions (if they exist). Only provide new or modified elements. Do NOT include text before or after the JSON, don't use markdown. Just the JSON alone. Language: ${guild.preferredLocale}. Server structure: ${JSON.stringify(existingStructure)}`
        }
    ]
});

        await statusChannel.send('🤖 Received AI recommendations...');

        const aiResponse = response.data.choices[0]?.message?.content;
        console.log('AI Response:', aiResponse);

        let serverStructure;
        try {
            serverStructure = JSON.parse(aiResponse);
            if (!serverStructure.roles && !serverStructure.channels && !serverStructure.categories) {
                throw new Error('Invalid AI response structure - missing required sections.');
            }
        } catch (err) {
            await statusChannel.send('❌ Error: Invalid AI response');
            throw new Error(`Failed to parse AI response: ${err.message}`);
        }

        if (serverStructure.delete) {
            await statusChannel.send('🗑️ Removing old channels and categories...');
            for (const item of serverStructure.delete) {
                const channel = guild.channels.cache.find(c => c.name === item);
                if (channel) {
                    await channel.delete();
                    console.log(`Deleted ${channel.type === ChannelType.GuildCategory ? 'category' : 'channel'}: ${item}`);
                }
            }
        }

		const channelsToMove = new Map();

        const createdRoles = {};
        if (serverStructure.roles) {
            await statusChannel.send('👥 Creating new roles...');
            for (const role of serverStructure.roles) {
                if (!guild.roles.cache.find(r => r.name === role.name)) {
                    try {
                        const permissions = role.permissions
                            .map(perm => PermissionFlagsBits[perm])
                            .filter(Boolean);

                        const newRole = await guild.roles.create({
                            name: role.name,
                            permissions: permissions,
                        });
                        createdRoles[role.name] = newRole.id;
                        console.log(`Created role: ${role.name}`);
                    } catch (err) {
                        console.error(`Error creating role "${role.name}":`, err);
                    }
                }
            }
        }

        const createdCategories = {};
        if (serverStructure.categories) {
            await statusChannel.send('📁 Creating categories...');
            for (const category of serverStructure.categories) {
                if (!guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === category.name)) {
                    const newCategory = await guild.channels.create({
                        name: category.name,
                        type: ChannelType.GuildCategory,
                    });
                    createdCategories[category.name] = newCategory.id;
                    console.log(`Created category: ${category.name}`);
                } else {
                    const existingCategory = guild.channels.cache.find(c => 
                        c.type === ChannelType.GuildCategory && 
                        c.name === category.name
                    );
                    createdCategories[category.name] = existingCategory.id;
                }
            }
        }

const channelsWithPermissions = new Map(); 
if (serverStructure.channels) {
    await statusChannel.send('💬 Creating channels...');
    for (const channel of serverStructure.channels) {
        if (!guild.channels.cache.find(c => c.name === channel.name)) {
            try {

                const newChannel = await guild.channels.create({
                    name: channel.name,
                    type: channel.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
                    topic: channel.description || '',
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect],
                        },
                        {
                            id: client.user.id,
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
                        }
                    ]
                });

                if (channel.category) {
                    channelsToMove.set(newChannel.id, channel.category);
                }

                if (channel.permissions) {
                    channelsWithPermissions.set(newChannel.id, channel.permissions);
                }

                console.log(`Created channel: ${channel.name}`);
            } catch (err) {
                console.error(`Error creating channel ${channel.name}:`, err);
            }
        }
    }
}

if (channelsToMove.size > 0) {
    await statusChannel.send('📋 Organizing channels into categories...');
    for (const [channelId, categoryName] of channelsToMove) {
        const channel = guild.channels.cache.get(channelId);
        const categoryId = createdCategories[categoryName];

        if (channel && categoryId) {
            try {
                await channel.setParent(categoryId);
                console.log(`Moved channel ${channel.name} to category ${categoryName}`);
            } catch (err) {
                console.error(`Error moving channel ${channel.name} to category ${categoryName}:`, err);
            }
        }
    }
}

if (channelsWithPermissions.size > 0) {
    await statusChannel.send('🔒 Applying channel permissions...');
    for (const [channelId, permissions] of channelsWithPermissions) {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
            try {

                await channel.permissionOverwrites.set([
                    {
                        id: guild.roles.everyone.id,
                        allow: [PermissionFlagsBits.ViewChannel],
                        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.Connect]
                    },
                    {
                        id: client.user.id,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]
                    }
                ]);

                for (const perm of permissions) {
                    const role = guild.roles.cache.find(r => r.name === perm.role);
                    if (role) {
                        await channel.permissionOverwrites.create(role, perm.permissions);
                    }
                }
                console.log(`Applied permissions for channel: ${channel.name}`);
            } catch (err) {
                console.error(`Error applying permissions for channel ${channel.name}:`, err);
            }
        }
    }
}

        await statusChannel.send('✅ Server reform completed successfully!');
        console.log('Server reform completed successfully.');

        setTimeout(async () => {
            try {
                await statusChannel.delete();
                console.log('Status channel deleted');
            } catch (err) {
                console.error('Error deleting status channel:', err);
            }
        }, 5000);

    } catch (err) {
        if (statusChannel) {
            await statusChannel.send(`❌ Error during server reform: ${err.message}`);
            setTimeout(async () => {
                try {
                    await statusChannel.delete();
                } catch (deleteErr) {
                    console.error('Error deleting status channel:', deleteErr);
                }
            }, 5000);
        }
        console.error('Error during server reform:', err);
    } finally {

        reformQueue.delete(guild.id);
    }
}

client.login(BOT_TOKEN);