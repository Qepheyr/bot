// ==========================================
// CONFIGURATION & SETUP
// ==========================================

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// 🔹 YOUR BOT TOKEN
const token = "8157925136:AAFPNIG6ipDPyAnwqc9cgIvBa2pcqVDfrW8";
const bot = new Telegraf(token);

// 🔹 YOUR MONGODB CONNECTION STRING
const mongoUri = "mongodb+srv://sandip102938:Q1g2Fbn7ewNqEvuK@test.ebvv4hf.mongodb.net/telegram_bot?retryWrites=true&w=majority";
let db;

// 🔹 SUPER ADMIN ID (Replace with your numeric ID)
const SUPER_ADMINS = [8435248854]; 

// ==========================================
// DATABASE CONNECTION
// ==========================================

async function connectDB() {
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        db = client.db();
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
        process.exit(1);
    }
}

async function initBot() {
    try {
        await db.collection('settings').updateOne(
            { type: 'config' },
            { 
                $setOnInsert: {
                    admins: SUPER_ADMINS,
                    channels: [],
                    apps: [],
                    startImage: "https://res.cloudinary.com/dneusgyzc/image/upload/v1763670359/1000106281_cfg1ke.jpg",
                    startMessage: "👋 *Welcome {first_name}!*\n\nPlease join our channels to access the premium tools.",
                    menuImage: "https://res.cloudinary.com/dneusgyzc/image/upload/v1763670359/1000106281_cfg1ke.jpg",
                    menuMessage: "✅ *Verification Complete*\n\nSelect an app below to generate codes.",
                    cooldownMinutes: 120
                }
            },
            { upsert: true }
        );
        console.log(`✅ Bot Config Loaded`);
    } catch (e) {
        console.error("❌ Init Error:", e);
    }
}

// ==========================================
// SCENES & MIDDLEWARE
// ==========================================

const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

// Global Handlers for Menu Navigation
bot.hears('✅ Verify Joined', async (ctx) => checkChannelsAndSendMenu(ctx));
bot.hears('🔙 Back', async (ctx) => checkChannelsAndSendMenu(ctx));

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// 1. Variable Replacer
function replaceVariables(text, user, app = null) {
    if (!text) return "";
    let replaced = text
        .replace(/{first_name}/g, user.first_name || 'User')
        .replace(/{last_name}/g, user.last_name || '')
        .replace(/{username}/g, user.username ? `@${user.username}` : 'No Username')
        .replace(/{id}/g, user.id);

    if (app) {
        replaced = replaced.replace(/{app_name}/g, app.name);
        // Generate random codes {code1} to {code10}
        const matches = replaced.match(/{code\d+}/g);
        if (matches) {
            matches.forEach(match => {
                const code = generateCode(app.codePrefix, app.codeLength);
                replaced = replaced.replace(match, code);
            });
        }
    }
    return replaced;
}

// 2. Code Generator
function generateCode(prefix = "", totalLength = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = prefix;
    const remaining = Math.max(0, totalLength - prefix.length);
    for (let i = 0; i < remaining; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// 3. Dynamic Image (Cloudinary Name Overlay)
function getImageUrl(baseUrl, user) {
    if (baseUrl && baseUrl.includes('{name}')) {
        const name = (user.first_name || user.username || "Agent").replace(/[^a-zA-Z0-9 ]/g, "").trim().substring(0, 10);
        return baseUrl.replace('{name}', encodeURIComponent(name));
    }
    return baseUrl || "";
}

// 4. Admin Check
async function isAdmin(userId) {
    if (SUPER_ADMINS.includes(userId)) return true;
    const config = await db.collection('settings').findOne({ type: 'config' });
    return config?.admins?.includes(userId) || false;
}

// 5. Check Channels (Handles Public & Private Requests)
async function getUnjoinedChannels(ctx) {
    const config = await db.collection('settings').findOne({ type: 'config' });
    if (!config?.channels?.length) return [];

    let unjoined = [];
    
    for (const ch of config.channels) {
        try {
            // PRIVATE CHANNEL: Auto-accept join request if it exists
            if (ch.type === 'private') {
                try {
                    await ctx.telegram.approveChatJoinRequest(ch.id, ctx.from.id);
                } catch (e) { /* Ignore if no request found */ }
            }

            const member = await ctx.telegram.getChatMember(ch.id, ctx.from.id);
            if (['left', 'kicked', 'restricted'].includes(member.status)) {
                unjoined.push(ch);
            }
        } catch (e) {
            // If bot is not admin or can't see chat, assume unjoined
            // console.log(`Error checking channel ${ch.id}:`, e.message);
            unjoined.push(ch); 
        }
    }
    return unjoined;
}

// ==========================================
// 🚀 USER FLOW
// ==========================================

bot.start(async (ctx) => {
    // Save/Update User
    try {
        await db.collection('users').updateOne(
            { id: ctx.from.id },
            { 
                $set: { 
                    firstName: ctx.from.first_name, 
                    username: ctx.from.username,
                    lastActive: new Date()
                },
                $setOnInsert: { joinedDate: new Date(), lastClaim: 0 }
            },
            { upsert: true }
        );
    } catch (e) { console.error("DB Error:", e); }

    await checkChannelsAndSendMenu(ctx);
});

async function checkChannelsAndSendMenu(ctx) {
    const config = await db.collection('settings').findOne({ type: 'config' });
    const unjoined = await getUnjoinedChannels(ctx);

    // --- CASE 1: USER HAS NOT JOINED CHANNELS ---
    if (unjoined.length > 0) {
        const imageUrl = getImageUrl(config.startImage, ctx.from);
        const caption = replaceVariables(config.startMessage, ctx.from);

        // 1. Inline Buttons (Links)
        const channelButtons = unjoined.map(ch => [
            Markup.button.url(ch.buttonLabel || 'Join Channel', ch.link)
        ]);

        // 2. Reply Keyboard (Verify Action)
        const replyKeyboard = Markup.keyboard([['✅ Verify Joined']]).resize();

        try {
            if (imageUrl) {
                await ctx.replyWithPhoto(imageUrl, {
                    caption: caption,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: channelButtons }
                });
            } else {
                await ctx.reply(caption, { 
                    parse_mode: 'Markdown', 
                    reply_markup: { inline_keyboard: channelButtons } 
                });
            }
            // Send Verify Button
            await ctx.reply("👇 Click below after joining:", replyKeyboard);
        } catch (e) {
            console.error("Start Error", e);
            await ctx.reply("Please join the channels to continue.", replyKeyboard);
        }
        return;
    }

    // --- CASE 2: USER IS VERIFIED (SHOW MENU) ---
    const imageUrl = getImageUrl(config.menuImage, ctx.from);
    const caption = replaceVariables(config.menuMessage, ctx.from);
    
    // Create App Grid (2 columns)
    const apps = config.apps || [];
    let keyboardRows = [];
    let currentRow = [];
    
    apps.forEach((app, index) => {
        currentRow.push(app.name);
        if (currentRow.length === 2 || index === apps.length - 1) {
            keyboardRows.push(currentRow);
            currentRow = [];
        }
    });

    // Admin Panel Button
    if (await isAdmin(ctx.from.id)) {
        keyboardRows.push(['/adminpanel']);
    }

    // Send Menu
    if (imageUrl) {
        await ctx.replyWithPhoto(imageUrl, { caption: caption, parse_mode: 'Markdown' });
    } else {
        await ctx.reply(caption, { parse_mode: 'Markdown' });
    }
    
    await ctx.reply("📱 Choose an App:", Markup.keyboard(keyboardRows).resize());
}

// --- HANDLE APP SELECTION ---
bot.on('text', async (ctx, next) => {
    // Ignore commands or system buttons
    if (ctx.message.text.startsWith('/') || ['✅ Verify Joined', '🔙 Back'].includes(ctx.message.text)) return next();

    const config = await db.collection('settings').findOne({ type: 'config' });
    const app = config.apps?.find(a => a.name === ctx.message.text);

    if (!app) return next(); // Not an app

    // Check Cooldown
    const user = await db.collection('users').findOne({ id: ctx.from.id });
    const now = Date.now();
    const cooldownMs = (config.cooldownMinutes || 120) * 60 * 1000;
    
    if (user.lastClaim && (now - user.lastClaim < cooldownMs)) {
        const remainingMs = cooldownMs - (now - user.lastClaim);
        const remainingMins = Math.ceil(remainingMs / 60000);
        return ctx.reply(`⏳ *Cooldown Active*\n\nWait ${remainingMins} mins before generating another code.`, { parse_mode: 'Markdown' });
    }

    // Generate Code Logic
    await db.collection('users').updateOne({ id: ctx.from.id }, { $set: { lastClaim: now } });

    const imageUrl = app.image || config.menuImage;
    const message = replaceVariables(app.message, ctx.from, app);

    if (imageUrl) {
        await ctx.replyWithPhoto(imageUrl, { caption: message, parse_mode: 'Markdown' });
    } else {
        await ctx.reply(message, { parse_mode: 'Markdown' });
    }
    
    await ctx.reply("Tap to go back:", Markup.keyboard([['🔙 Back']]).resize());
});

// ==========================================
// 🛡️ ADMIN PANEL SCENES
// ==========================================

const admin_scene = new Scenes.BaseScene('admin_scene');

bot.command('adminpanel', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    await ctx.scene.enter('admin_scene');
});

admin_scene.enter(async (ctx) => {
    const txt = "👮‍♂️ *Admin Panel*\n\nSelect an option:";
    const kb = [
        [{ text: '🖼 Set Start Image', callback_data: 'set_start_img' }, { text: '📝 Set Start Msg', callback_data: 'set_start_msg' }],
        [{ text: '🖼 Set Menu Image', callback_data: 'set_menu_img' }, { text: '📝 Set Menu Msg', callback_data: 'set_menu_msg' }],
        [{ text: '📺 Manage Channels', callback_data: 'manage_channels' }, { text: '📱 Manage Apps', callback_data: 'manage_apps' }],
        [{ text: '⏱ Set Cooldown', callback_data: 'set_timer' }],
        [{ text: '📢 Broadcast', callback_data: 'broadcast_entry' }], // New Broadcast
        [{ text: '❌ Close', callback_data: 'close_admin' }]
    ];
    
    try {
        await ctx.editMessageText(txt, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } });
    } catch (e) {
        await ctx.replyWithMarkdown(txt, { reply_markup: { inline_keyboard: kb } });
    }
});

admin_scene.action('close_admin', ctx => ctx.scene.leave());

// --- GENERIC INPUT SCENES ---
function createInputScene(id, prompt, field) {
    const s = new Scenes.BaseScene(id);
    s.enter(ctx => ctx.reply(prompt, Markup.inlineKeyboard([Markup.button.callback('Cancel', 'cancel')])));
    s.action('cancel', async ctx => { await ctx.answerCbQuery(); await ctx.scene.leave(); await ctx.scene.enter('admin_scene'); });
    s.on('text', async ctx => {
        await db.collection('settings').updateOne({ type: 'config' }, { $set: { [field]: ctx.message.text } });
        await ctx.reply(`✅ Updated ${field}`);
        await ctx.scene.leave();
        await ctx.scene.enter('admin_scene');
    });
    return s;
}

stage.register(
    createInputScene('set_start_img_s', "Send Start Image URL (Use {name} for overlay):", 'startImage'),
    createInputScene('set_start_msg_s', "Send Start Msg (Vars: {first_name}, {username}):", 'startMessage'),
    createInputScene('set_menu_img_s', "Send Menu Image URL:", 'menuImage'),
    createInputScene('set_menu_msg_s', "Send Menu Msg (Vars: {first_name}):", 'menuMessage'),
    createInputScene('set_timer_s', "Send Cooldown in Minutes (e.g. 60):", 'cooldownMinutes')
);

admin_scene.action('set_start_img', ctx => ctx.scene.enter('set_start_img_s'));
admin_scene.action('set_start_msg', ctx => ctx.scene.enter('set_start_msg_s'));
admin_scene.action('set_menu_img', ctx => ctx.scene.enter('set_menu_img_s'));
admin_scene.action('set_menu_msg', ctx => ctx.scene.enter('set_menu_msg_s'));
admin_scene.action('set_timer', ctx => ctx.scene.enter('set_timer_s'));

// --- MANAGE CHANNELS ---
const manage_channels_scene = new Scenes.BaseScene('manage_channels_scene');
stage.register(manage_channels_scene);
admin_scene.action('manage_channels', ctx => ctx.scene.enter('manage_channels_scene'));

manage_channels_scene.enter(async ctx => {
    const config = await db.collection('settings').findOne({ type: 'config' });
    const kb = (config.channels || []).map(c => [{ text: `🗑 Del ${c.buttonLabel}`, callback_data: `del_c_${c.id}` }]);
    kb.push([{ text: '➕ Add Public', callback_data: 'add_public' }, { text: '➕ Add Private', callback_data: 'add_private' }]);
    kb.push([{ text: '🔙 Back', callback_data: 'back' }]);
    await ctx.editMessageText("📺 *Manage Channels*", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(e => ctx.reply("Manage Channels", { reply_markup: { inline_keyboard: kb } }));
});

manage_channels_scene.action('back', ctx => ctx.scene.enter('admin_scene'));
manage_channels_scene.action(/^del_c_(.+)$/, async ctx => {
    await db.collection('settings').updateOne({ type: 'config' }, { $pull: { channels: { id: parseInt(ctx.match[1]) } } });
    await ctx.answerCbQuery("Deleted");
    ctx.scene.reenter();
});

// Channel Add Wizard
const add_chan_wiz = new Scenes.WizardScene('add_chan_wiz',
    async (ctx) => {
        await ctx.reply(`1️⃣ Enter Button Name for ${ctx.scene.state.type} channel:`);
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.name = ctx.message.text;
        if (ctx.scene.state.type === 'public') {
            await ctx.reply("2️⃣ Send Username (@name) or Forward Message from Channel:");
            return ctx.wizard.next();
        }
        await ctx.reply("2️⃣ Send Private Channel ID (e.g. -100...):");
        return ctx.wizard.selectStep(3);
    },
    async (ctx) => { // Public Logic
        try {
            const chat = ctx.message.forward_from_chat || await ctx.telegram.getChat(ctx.message.text);
            const link = `https://t.me/${chat.username}`;
            await saveChan(chat.id, chat.title, link, ctx.scene.state.name, 'public');
            await ctx.reply("✅ Public Channel Added!");
        } catch(e) { await ctx.reply("❌ Error. Make sure bot is admin."); }
        return ctx.scene.enter('manage_channels_scene');
    },
    async (ctx) => { // Private ID
        ctx.scene.state.id = parseInt(ctx.message.text);
        await ctx.reply("3️⃣ Send Invite Link:");
        return ctx.wizard.next();
    },
    async (ctx) => { // Private Link
        await saveChan(ctx.scene.state.id, "Private", ctx.message.text, ctx.scene.state.name, 'private');
        await ctx.reply("✅ Private Channel Added!");
        return ctx.scene.enter('manage_channels_scene');
    }
);
async function saveChan(id, title, link, label, type) {
    await db.collection('settings').updateOne({ type: 'config' }, { $push: { channels: { id, title, link, buttonLabel: label, type } } });
}
stage.register(add_chan_wiz);
manage_channels_scene.action('add_public', ctx => ctx.scene.enter('add_chan_wiz', { type: 'public' }));
manage_channels_scene.action('add_private', ctx => ctx.scene.enter('add_chan_wiz', { type: 'private' }));

// --- MANAGE APPS ---
const manage_apps_scene = new Scenes.BaseScene('manage_apps_scene');
stage.register(manage_apps_scene);
admin_scene.action('manage_apps', ctx => ctx.scene.enter('manage_apps_scene'));

manage_apps_scene.enter(async ctx => {
    const config = await db.collection('settings').findOne({ type: 'config' });
    const kb = (config.apps || []).map(a => [{ text: `✏️ ${a.name}`, callback_data: `noop` }, { text: `🗑`, callback_data: `del_app_${a.name}` }]);
    kb.push([{ text: '➕ Add App', callback_data: 'add_app' }, { text: '🔙 Back', callback_data: 'back' }]);
    await ctx.editMessageText("📱 *Manage Apps*", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(e => ctx.reply("Manage Apps", { reply_markup: { inline_keyboard: kb } }));
});
manage_apps_scene.action('back', ctx => ctx.scene.enter('admin_scene'));
manage_apps_scene.action('noop', ctx => ctx.answerCbQuery("Use Delete to remove."));
manage_apps_scene.action(/^del_app_(.+)$/, async ctx => {
    await db.collection('settings').updateOne({ type: 'config' }, { $pull: { apps: { name: ctx.match[1] } } });
    ctx.scene.reenter();
});

const add_app_wiz = new Scenes.WizardScene('add_app_wiz',
    async (ctx) => { await ctx.reply("1️⃣ App Name (Button Text):"); return ctx.wizard.next(); },
    async (ctx) => { ctx.scene.state.name = ctx.message.text; await ctx.reply("2️⃣ Image URL:"); return ctx.wizard.next(); },
    async (ctx) => { ctx.scene.state.img = ctx.message.text; await ctx.reply("3️⃣ Code Prefix (e.g. XY):"); return ctx.wizard.next(); },
    async (ctx) => { ctx.scene.state.pre = ctx.message.text; await ctx.reply("4️⃣ Code Length (e.g. 12):"); return ctx.wizard.next(); },
    async (ctx) => { 
        ctx.scene.state.len = parseInt(ctx.message.text); 
        await ctx.reply("5️⃣ Message (Vars: {code1}, {code2}):"); 
        return ctx.wizard.next(); 
    },
    async (ctx) => {
        await db.collection('settings').updateOne({ type: 'config' }, { 
            $push: { apps: { name: ctx.scene.state.name, image: ctx.scene.state.img, codePrefix: ctx.scene.state.pre, codeLength: ctx.scene.state.len, message: ctx.message.text } } 
        });
        await ctx.reply("✅ App Added!");
        return ctx.scene.enter('manage_apps_scene');
    }
);
stage.register(add_app_wiz);
manage_apps_scene.action('add_app', ctx => ctx.scene.enter('add_app_wiz'));

// --- BROADCAST (WITH OPTIONAL BUTTONS) ---
const broadcast_wiz = new Scenes.WizardScene('broadcast_wiz',
    async (ctx) => {
        await ctx.reply("📢 *Broadcast Mode*\n\nSend the message (Text, Photo, or Video) you want to broadcast.\nType 'cancel' to stop.");
        return ctx.wizard.next();
    },
    async (ctx) => {
        if (ctx.message.text?.toLowerCase() === 'cancel') {
            await ctx.reply("Cancelled.");
            return ctx.scene.leave();
        }
        
        // Save the content
        ctx.scene.state.msg = ctx.message;
        
        await ctx.reply("🔗 Do you want to add a Button (Link)?", {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Yes, Add Button', callback_data: 'yes_btn' }],
                    [{ text: 'No, Send Now', callback_data: 'no_btn' }]
                ]
            }
        });
        return ctx.wizard.next();
    },
    async (ctx) => {
        // Handle Callback
        if (ctx.callbackQuery) {
            const data = ctx.callbackQuery.data;
            if (data === 'no_btn') {
                await ctx.answerCbQuery();
                await startBroadcast(ctx, ctx.scene.state.msg, null);
                return ctx.scene.leave();
            } else if (data === 'yes_btn') {
                await ctx.answerCbQuery();
                await ctx.reply("🔤 Enter Button Text:");
                return ctx.wizard.next();
            }
        }
        // If user typed something instead of clicking
        await ctx.reply("Please click a button above.");
    },
    async (ctx) => {
        ctx.scene.state.btnText = ctx.message.text;
        await ctx.reply("🌐 Enter Button URL (https://...):");
        return ctx.wizard.next();
    },
    async (ctx) => {
        const btnUrl = ctx.message.text;
        const btn = Markup.inlineKeyboard([[Markup.button.url(ctx.scene.state.btnText, btnUrl)]]);
        await startBroadcast(ctx, ctx.scene.state.msg, btn);
        return ctx.scene.leave();
    }
);

async function startBroadcast(ctx, msgObject, keyboard) {
    const users = await db.collection('users').find({}).toArray();
    await ctx.reply(`🚀 Broadcasting to ${users.length} users...`);
    
    let success = 0;
    for (const u of users) {
        try {
            const extra = keyboard ? { reply_markup: keyboard.reply_markup } : {};
            await ctx.telegram.copyMessage(u.id, ctx.chat.id, msgObject.message_id, extra);
            success++;
            await new Promise(r => setTimeout(r, 40)); // Rate limit safety
        } catch (e) {
            // console.log(`Failed for ${u.id}: ${e.message}`);
        }
    }
    await ctx.reply(`✅ Broadcast Complete. Sent to ${success} users.`);
    await ctx.scene.enter('admin_scene');
}

stage.register(broadcast_wiz);
admin_scene.action('broadcast_entry', ctx => ctx.scene.enter('broadcast_wiz'));

// ==========================================
// SERVER & START
// ==========================================

const PORT = process.env.PORT || 3000;
const express = require('express');
const app = express();

app.get('/', (req, res) => res.send('Bot is Running...'));

app.listen(PORT, () => {
    connectDB().then(() => {
        initBot().then(() => {
            console.log('🤖 Bot Started Successfully!');
            bot.launch({ dropPendingUpdates: true });
        });
    });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
