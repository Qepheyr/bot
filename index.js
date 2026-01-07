// ==========================================
// CONFIGURATION & SETUP
// ==========================================

const { Telegraf, Scenes, session } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Initialize bot with your token
const token = "8157925136:AAFPNIG6ipDPyAnwqc9cgIvBa2pcqVDfrW8";

const bot = new Telegraf(token);

// MongoDB connection with your database
const mongoUri = "mongodb+srv://sandip102938:Q1g2Fbn7ewNqEvuK@test.ebvv4hf.mongodb.net/telegram_bot?retryWrites=true&w=majority";
let db;

async function connectDB() {
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        db = client.db();
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        process.exit(1);
    }
}

// Initialize scenes and session
const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

// Scene handler factory
function answerHandler(sceneId) {
    return new Scenes.BaseScene(sceneId);
}

// SCENE HANDLERS
const broadcast_scene = answerHandler('broadcast_scene');

// Channel Scenes
const add_chan_name_scene = answerHandler('add_chan_name_scene');
const add_chan_id_scene = answerHandler('add_chan_id_scene');
const edit_chan_name_scene = answerHandler('edit_chan_name_scene');
const edit_chan_id_scene = answerHandler('edit_chan_id_scene');

// Button Scenes
const add_btn_label_scene = answerHandler('add_btn_label_scene');
const add_btn_msg_scene = answerHandler('add_btn_msg_scene');
const edit_btn_label_scene = answerHandler('edit_btn_label_scene');
const edit_btn_msg_scene = answerHandler('edit_btn_msg_scene');

// Add scenes to stage
stage.register(
    broadcast_scene,
    add_chan_name_scene,
    add_chan_id_scene,
    edit_chan_name_scene,
    edit_chan_id_scene,
    add_btn_label_scene,
    add_btn_msg_scene,
    edit_btn_label_scene,
    edit_btn_msg_scene
);

// 🔐 ADMIN CONFIGURATION
const ADMIN_IDS = [8435248854];

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

async function initBot() {
    try {
        // Initialize DB config
        await db.collection('admin').updateOne(
            { type: 'config' },
            { 
                $set: { 
                    type: 'config', 
                    admins: ADMIN_IDS
                },
                $setOnInsert: {
                    channels: [], 
                    buttons: [] 
                }
            },
            { upsert: true }
        );
        console.log(`✅ Bot initialized. Admins loaded: ${ADMIN_IDS.length}`);
    } catch (e) {
        console.error("❌ Error initializing bot:", e);
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Notify ALL Admins
async function notifyAdmin(text) {
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, text);
        } catch (e) {
            console.error(`Failed to notify admin ${adminId}`, e.message);
        }
    }
}

// 🧠 SMART NAME LOGIC
function getSanitizedName(user) {
    let rawFirst = user.first_name || "";
    let cleanFirst = rawFirst.replace(/[^a-zA-Z0-9 ]/g, "").trim();

    let rawUser = user.username || "";
    let cleanUser = rawUser.replace(/[^a-zA-Z0-9 ]/g, "").trim();

    let finalName = "Agent";

    if (cleanFirst.length > 0 && cleanFirst.length <= 8) {
        finalName = cleanFirst;
    } 
    else if (cleanUser.length > 0 && (cleanUser.length < cleanFirst.length || cleanFirst.length === 0)) {
        finalName = cleanUser;
    }
    else if (cleanFirst.length > 0) {
        finalName = cleanFirst;
    }
    else if (cleanUser.length > 0) {
        finalName = cleanUser;
    }

    if (finalName.length > 10) {
        return finalName.substring(0, 9) + "...";
    }
    return finalName;
}

// Check Admin Status
async function isAdmin(userId) {
    if (ADMIN_IDS.includes(userId)) return true;

    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        if (config && config.admins) {
            return config.admins.some(id => String(id) === String(userId));
        }
    } catch (e) {}
    return false;
}

// Get Unjoined Channels
async function getUnjoinedChannels(userId) {
    const config = await db.collection('admin').findOne({ type: 'config' });
    if (!config || !config.channels || config.channels.length === 0) return [];

    let unjoined = [];
    for (const ch of config.channels) {
        try {
            const member = await bot.telegram.getChatMember(ch.id, userId);
            const status = member.status;
            if (status === 'left' || status === 'kicked' || status === 'restricted') {
                unjoined.push(ch);
            }
        } catch (e) {
            unjoined.push(ch); 
        }
    }
    return unjoined;
}

// ==========================================
// USER FLOW
// ==========================================

bot.start(async (ctx) => {
    try {
        const user = ctx.from;
        
        // 1. Check for New User
        const existingUser = await db.collection('info').findOne({ user: user.id });
        
        if (!existingUser) {
            // Log New User
            await db.collection('info').insertOne({
                user: user.id,
                firstName: user.first_name,
                username: user.username,
                joinedAll: false,
                joinedDate: new Date()
            });
            
            // Notify ALL Admins
            const userLink = user.username ? `@${user.username}` : user.first_name;
            await notifyAdmin(`🆕 *New User Joined*\nID: \`${user.id}\`\nUser: ${userLink}`);
        } else {
            // Update details
            await db.collection('info').updateOne(
                { user: user.id },
                { $set: { firstName: user.first_name, username: user.username, lastActive: new Date() } }
            );
        }

        await checkChannelsAndSendMenu(ctx);
    } catch (e) {
        console.error(e);
    }
});

async function checkChannelsAndSendMenu(ctx, isCallback = false) {
    const unjoined = await getUnjoinedChannels(ctx.from.id);
    
    // 1. Prepare Image
    const cleanName = getSanitizedName(ctx.from);
    const imageUrl = `https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:${encodeURIComponent(cleanName)},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg`;

    // 2. Clean up previous message if callback
    if (isCallback) {
        try { await ctx.deleteMessage(); } catch(e) {}
    }

    // --- SCENARIO 1: NOT JOINED ALL CHANNELS ---
    if (unjoined.length > 0) {
        await db.collection('info').updateOne({ user: ctx.from.id }, { $set: { joinedAll: false } });

        let buttons = unjoined.map(ch => [{ 
            text: ch.buttonLabel || `Join ${ch.title}`, 
            url: ch.link 
        }]);
        buttons.push([{ text: '✅ Check Joined', callback_data: 'check_joined' }]);
        
        await ctx.replyWithPhoto(imageUrl, {
            caption: "👋 *Welcome! We are Premium Agents.*\n\n⚠️ _Access Denied_\nTo access our exclusive agent list, you must join our affiliate channels below:",
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    } 
    
    // --- SCENARIO 2: JOINED ALL CHANNELS ---
    
    const userInfo = await db.collection('info').findOne({ user: ctx.from.id });
    if (!userInfo.joinedAll) {
        await db.collection('info').updateOne({ user: ctx.from.id }, { $set: { joinedAll: true } });
        
        // Notify ALL Admins
        const userLink = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
        await notifyAdmin(`✅ *User Joined All Channels*\nID: \`${ctx.from.id}\`\nUser: ${userLink}`);
    }

    // Get Buttons from DB
    const config = await db.collection('admin').findOne({ type: 'config' });
    const buttonsData = (config && config.buttons) ? config.buttons : [];
    
    let keyboard = [];
    if (buttonsData.length === 0) {
        keyboard.push([{ text: 'Coming Soon...', callback_data: 'noop' }]);
    } else {
        buttonsData.forEach(btn => {
            keyboard.push([{ text: btn.label, callback_data: `agent_view_${btn.id}` }]);
        });
    }

    await ctx.replyWithPhoto(imageUrl, {
        caption: "🎉 *Welcome to the Agent Panel!*\n\n✅ _Verification Successful_\nSelect a category below to view details:",
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
}

bot.action('check_joined', async (ctx) => {
    await checkChannelsAndSendMenu(ctx, true);
});

bot.action('noop', async (ctx) => { await ctx.answerCbQuery("No agents added yet."); });

// --- Agent Button Click Handling ---
bot.action(/^agent_view_(.+)$/, async (ctx) => {
    try {
        const btnId = ctx.match[1];
        const config = await db.collection('admin').findOne({ type: 'config' });
        
        const button = config.buttons.find(b => String(b.id) === String(btnId));

        if (button) {
            try {
                await ctx.replyWithMarkdown(button.message, {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'delete_me' }]] }
                });
            } catch (err) {
                await ctx.reply(button.message, {
                    reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'delete_me' }]] }
                });
            }
        } else {
            await ctx.answerCbQuery("Agent details not found. Try refreshing.");
        }
    } catch (e) {
        console.error(e);
    }
});

bot.action('delete_me', async (ctx) => {
    try { await ctx.deleteMessage(); } catch (e) {}
});

// ==========================================
// 🛡️ ADMIN PANEL
// ==========================================

bot.command('adminpanel', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    await sendAdminPanel(ctx);
});

async function sendAdminPanel(ctx) {
    const text = "👮‍♂️ *Admin Control Panel*\n\nSelect an option below:";
    const keyboard = [
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '👥 User Stats', callback_data: 'admin_userdata' }],
        [{ text: '📺 Manage Channels', callback_data: 'admin_channels' }],
        [{ text: '⚙️ Manage Agent Buttons', callback_data: 'admin_buttons' }]
    ];
    
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
    } else {
        await ctx.replyWithMarkdown(text, { reply_markup: { inline_keyboard: keyboard } });
    }
}

// ------------------------------------------
// 1. MANAGE CHANNELS
// ------------------------------------------

bot.action('admin_channels', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config.channels || [];

    let text = "📺 *Manage Channels*\nSelect a channel to Edit/Delete or Add New:\n";
    let keyboard = [];

    channels.forEach((ch) => {
        keyboard.push([{ text: `✏️ ${ch.buttonLabel}`, callback_data: `manage_chan_${ch.id}` }]);
    });

    keyboard.push([{ text: '➕ Add New Channel', callback_data: 'add_new_channel' }]);
    keyboard.push([{ text: '🔙 Back', callback_data: 'back_admin_main' }]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action('add_new_channel', async (ctx) => {
    await ctx.replyWithMarkdown("1️⃣ *Add Channel*\nEnter the **Button Name** (e.g., 'Join Main Channel'):\nType 'Cancel' to stop.");
    await ctx.scene.enter('add_chan_name_scene');
});

add_chan_name_scene.on('text', async (ctx) => {
    if (ctx.message.text === 'Cancel') return ctx.scene.leave();
    ctx.scene.state.name = ctx.message.text;
    await ctx.replyWithMarkdown("2️⃣ *Channel Details*\nNow send the **Channel ID** (-100...) or **Username** (@name) or **Forward a Message**.\n\n⚠️ Bot must be Admin in channel.");
    await ctx.scene.leave();
    await ctx.scene.enter('add_chan_id_scene', { name: ctx.message.text });
});

add_chan_id_scene.on('message', async (ctx) => {
    if (ctx.message.text === 'Cancel') return ctx.scene.leave();
    
    const name = ctx.scene.state.name;
    let chatId;

    if (ctx.message.forward_from_chat) chatId = ctx.message.forward_from_chat.id;
    else if (ctx.message.text) chatId = ctx.message.text.trim();
    else return ctx.reply("Invalid ID.");

    try {
        const chat = await ctx.telegram.getChat(chatId);
        const member = await ctx.telegram.getChatMember(chat.id, ctx.botInfo.id);
        
        if (member.status !== 'administrator') {
            await ctx.reply("❌ *Error: Bot is not an Admin.*\nMake bot admin and try again.");
            return ctx.scene.leave();
        }

        const link = chat.username ? `https://t.me/${chat.username}` : await ctx.telegram.exportChatInviteLink(chat.id);

        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { channels: { id: chat.id, title: chat.title, link: link, buttonLabel: name } } }
        );
        
        await ctx.reply("✅ Channel Added!");
    } catch (e) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
    await ctx.scene.leave();
});

bot.action(/^manage_chan_(.+)$/, async (ctx) => {
    const chanId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channel = config.channels.find(c => String(c.id) === String(chanId));

    if (!channel) return ctx.answerCbQuery("Channel not found.");

    const text = `📺 *Edit Channel*\nName: ${channel.buttonLabel}\nID: ${channel.id}`;
    const keyboard = [
        [{ text: '✏️ Edit Name', callback_data: `edit_c_name_${chanId}` }],
        [{ text: '✏️ Edit ID/Link', callback_data: `edit_c_id_${chanId}` }],
        [{ text: '🗑 Delete', callback_data: `del_chan_${chanId}` }],
        [{ text: '🔙 Back', callback_data: 'admin_channels' }]
    ];
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action(/^del_chan_(.+)$/, async (ctx) => {
    const chanId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const newChans = config.channels.filter(c => String(c.id) !== String(chanId));
    await db.collection('admin').updateOne({ type: 'config' }, { $set: { channels: newChans } });
    await ctx.answerCbQuery("Deleted.");
    await ctx.editMessageText("🗑 Channel Deleted.", { reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: 'admin_channels'}]]}});
});

bot.action(/^edit_c_name_(.+)$/, async (ctx) => {
    await ctx.reply("Enter new **Button Name**:");
    await ctx.scene.enter('edit_chan_name_scene', { id: ctx.match[1] });
});
edit_chan_name_scene.on('text', async (ctx) => {
    const id = ctx.scene.state.id;
    const config = await db.collection('admin').findOne({ type: 'config' });
    let channels = config.channels;
    const idx = channels.findIndex(c => String(c.id) === String(id));
    
    if (idx > -1) {
        channels[idx].buttonLabel = ctx.message.text;
        await db.collection('admin').updateOne({ type: 'config' }, { $set: { channels: channels } });
        await ctx.reply("✅ Name Updated.");
    }
    await ctx.scene.leave();
});

bot.action(/^edit_c_id_(.+)$/, async (ctx) => {
    await ctx.reply("Send new **Channel ID/Username/Forward**. Bot must be Admin.");
    await ctx.scene.enter('edit_chan_id_scene', { id: ctx.match[1] });
});
edit_chan_id_scene.on('message', async (ctx) => {
    const oldId = ctx.scene.state.id;
    let newId;
    if (ctx.message.forward_from_chat) newId = ctx.message.forward_from_chat.id;
    else if (ctx.message.text) newId = ctx.message.text.trim();
    else return ctx.reply("Invalid.");

    try {
        const chat = await ctx.telegram.getChat(newId);
        const member = await ctx.telegram.getChatMember(chat.id, ctx.botInfo.id);
        if (member.status !== 'administrator') {
            await ctx.reply("❌ Bot not admin."); 
            return ctx.scene.leave();
        }
        const link = chat.username ? `https://t.me/${chat.username}` : await ctx.telegram.exportChatInviteLink(chat.id);
        
        const config = await db.collection('admin').findOne({ type: 'config' });
        let channels = config.channels;
        const oldChan = channels.find(c => String(c.id) === String(oldId));
        const newChans = channels.filter(c => String(c.id) !== String(oldId));
        
        newChans.push({ 
            id: chat.id, 
            title: chat.title, 
            link: link, 
            buttonLabel: oldChan.buttonLabel 
        });

        await db.collection('admin').updateOne({ type: 'config' }, { $set: { channels: newChans } });
        await ctx.reply("✅ Channel ID Updated.");
    } catch (e) { await ctx.reply("Error: " + e.message); }
    await ctx.scene.leave();
});

// ------------------------------------------
// 2. MANAGE AGENT BUTTONS
// ------------------------------------------

bot.action('admin_buttons', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    const config = await db.collection('admin').findOne({ type: 'config' });
    const buttons = config.buttons || [];

    let text = "⚙️ *Manage Agent Buttons*\nSelect a button to Edit/Delete or Add New:\n";
    let keyboard = [];

    buttons.forEach((btn) => {
        keyboard.push([{ text: `✏️ ${btn.label}`, callback_data: `manage_btn_${btn.id}` }]);
    });

    keyboard.push([{ text: '➕ Add New Button', callback_data: 'add_new_btn' }]);
    keyboard.push([{ text: '🔙 Back', callback_data: 'back_admin_main' }]);

    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action('add_new_btn', async (ctx) => {
    await ctx.replyWithMarkdown("1️⃣ *Add Button*\nEnter the **Button Label** (e.g., 'WhatsApp Agents'):");
    await ctx.scene.enter('add_btn_label_scene');
});
add_btn_label_scene.on('text', async (ctx) => {
    if (ctx.message.text === 'Cancel') return ctx.scene.leave();
    ctx.scene.state.label = ctx.message.text;
    await ctx.replyWithMarkdown("2️⃣ *Button Message*\nEnter the **Message** content for this agent:");
    await ctx.scene.leave();
    await ctx.scene.enter('add_btn_msg_scene', { label: ctx.message.text });
});
add_btn_msg_scene.on('text', async (ctx) => {
    const id = `btn_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $push: { buttons: { id: id, label: ctx.scene.state.label, message: ctx.message.text } } }
    );
    await ctx.reply("✅ Button Added.");
    await ctx.scene.leave();
});

bot.action(/^manage_btn_(.+)$/, async (ctx) => {
    const btnId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const btn = config.buttons.find(b => String(b.id) === String(btnId));
    if (!btn) return ctx.answerCbQuery("Not found.");

    const text = `⚙️ *Edit Button*\nLabel: ${btn.label}`;
    const keyboard = [
        [{ text: '✏️ Edit Label', callback_data: `edit_b_lbl_${btnId}` }],
        [{ text: '✏️ Edit Message', callback_data: `edit_b_msg_${btnId}` }],
        [{ text: '🗑 Delete', callback_data: `del_btn_${btnId}` }],
        [{ text: '🔙 Back', callback_data: 'admin_buttons' }]
    ];
    await ctx.editMessageText(text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: keyboard } });
});

bot.action(/^del_btn_(.+)$/, async (ctx) => {
    const btnId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const newBtns = config.buttons.filter(b => String(b.id) !== String(btnId));
    await db.collection('admin').updateOne({ type: 'config' }, { $set: { buttons: newBtns } });
    await ctx.answerCbQuery("Deleted.");
    await ctx.editMessageText("🗑 Button Deleted.", { reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: 'admin_buttons'}]]}});
});

bot.action(/^edit_b_lbl_(.+)$/, async (ctx) => {
    await ctx.reply("Enter new **Button Label**:");
    await ctx.scene.enter('edit_btn_label_scene', { id: ctx.match[1] });
});
edit_btn_label_scene.on('text', async (ctx) => {
    const id = ctx.scene.state.id;
    const config = await db.collection('admin').findOne({ type: 'config' });
    let buttons = config.buttons;
    const idx = buttons.findIndex(b => String(b.id) === String(id));
    if (idx > -1) {
        buttons[idx].label = ctx.message.text;
        await db.collection('admin').updateOne({ type: 'config' }, { $set: { buttons: buttons } });
        await ctx.reply("✅ Label Updated.");
    }
    await ctx.scene.leave();
});

bot.action(/^edit_b_msg_(.+)$/, async (ctx) => {
    await ctx.reply("Enter new **Message Content**:");
    await ctx.scene.enter('edit_btn_msg_scene', { id: ctx.match[1] });
});
edit_btn_msg_scene.on('text', async (ctx) => {
    const id = ctx.scene.state.id;
    const config = await db.collection('admin').findOne({ type: 'config' });
    let buttons = config.buttons;
    const idx = buttons.findIndex(b => String(b.id) === String(id));
    if (idx > -1) {
        buttons[idx].message = ctx.message.text;
        await db.collection('admin').updateOne({ type: 'config' }, { $set: { buttons: buttons } });
        await ctx.reply("✅ Message Updated.");
    }
    await ctx.scene.leave();
});

// ------------------------------------------
// 3. BROADCAST & USER DATA
// ------------------------------------------

bot.action('admin_broadcast', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    await ctx.reply("📢 Send message to broadcast. Type 'Cancel' to stop.");
    await ctx.scene.enter('broadcast_scene');
});

broadcast_scene.on('message', async (ctx) => {
    if (ctx.message.text === 'Cancel') return ctx.scene.leave();
    const users = await db.collection('info').find({}).toArray();
    await ctx.reply(`🚀 Broadcasting to ${users.length} users...`);
    await ctx.scene.leave();
    
    // Broadcast to all users
    for (const u of users) {
        try { await ctx.telegram.copyMessage(u.user, ctx.chat.id, ctx.message.message_id); } 
        catch (e) {}
        await new Promise(r => setTimeout(r, 50));
    }
    await ctx.reply("✅ Broadcast Done.");
});

bot.action('admin_userdata', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    const users = await db.collection('info').find({}).toArray();
    let msg = `👥 *Total Users:* ${users.length}\n\n`;
    users.slice(0, 40).forEach((u, i) => {
        msg += `${i+1}. [${u.user}](tg://user?id=${u.user}) ${u.joinedAll ? '✅' : '❌'}\n`;
    });
    await ctx.replyWithMarkdown(msg);
});

bot.action('back_admin_main', async (ctx) => {
    await sendAdminPanel(ctx);
});

// ==========================================
// START BOT
// ==========================================

async function startBot() {
    try {
        // Connect to database
        await connectDB();
        
        // Initialize bot settings
        await initBot();
        
        // Start bot
        await bot.launch();
        console.log('🤖 Bot is running...');
        
        // Enable graceful stop
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

// Handle Railway port binding
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV === 'production') {
    // For Railway deployment, we need to start a web server
    const express = require('express');
    const app = express();
    
    app.get('/', (req, res) => {
        res.send('Telegram Bot is running!');
    });
    
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        startBot();
    });
} else {
    // For local development
    startBot();
}

console.log("Bot Starting...");
