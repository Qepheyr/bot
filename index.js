// ==========================================
// CONFIGURATION & SETUP
// ==========================================

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// New Token
const token = "8157925136:AAFPNIG6ipDPyAnwqc9cgIvBa2pcqVDfrW8";
const bot = new Telegraf(token);

// MongoDB URI
const mongoUri = "mongodb+srv://sandip102938:Q1g2Fbn7ewNqEvuK@test.ebvv4hf.mongodb.net/telegram_bot?retryWrites=true&w=majority";
let db;

// Admin IDs (Hardcoded + DB)
const SUPER_ADMINS = [8435248854]; 

// ==========================================
// DATABASE & INIT
// ==========================================

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
                    cooldownMinutes: 120 // Default 2 hours
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
// MIDDLEWARES & SCENES
// ==========================================

const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

// Handle "Verify" and "Back" text commands globally
bot.hears('✅ Verify Joined', async (ctx) => checkChannelsAndSendMenu(ctx));
bot.hears('🔙 Back', async (ctx) => checkChannelsAndSendMenu(ctx));

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// 1. Dynamic Variable Replacer
function replaceVariables(text, user, app = null) {
    let replaced = text
        .replace(/{first_name}/g, user.first_name || 'User')
        .replace(/{last_name}/g, user.last_name || '')
        .replace(/{username}/g, user.username ? `@${user.username}` : 'No Username')
        .replace(/{id}/g, user.id);

    if (app) {
        replaced = replaced.replace(/{app_name}/g, app.name);
        
        // Generate Codes {code1} ... {code10}
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

// 3. Image URL Generator (Cloudinary Name Overlay)
function getImageUrl(baseUrl, user) {
    if (baseUrl.includes('{name}')) {
        const name = (user.first_name || user.username || "Agent").replace(/[^a-zA-Z0-9 ]/g, "").trim().substring(0, 10);
        // Replace placeholder or append specific Cloudinary logic if needed
        // Assuming user puts a cloudinary URL like: .../upload/l_text:Style_{name}/...
        // For simplicity, we just replace {name} with sanitized name
        return baseUrl.replace('{name}', encodeURIComponent(name));
    }
    return baseUrl;
}

// 4. Admin Check
async function isAdmin(userId) {
    if (SUPER_ADMINS.includes(userId)) return true;
    const config = await db.collection('settings').findOne({ type: 'config' });
    return config?.admins?.includes(userId) || false;
}

// 5. Channel Status Checker
async function getUnjoinedChannels(ctx) {
    const config = await db.collection('settings').findOne({ type: 'config' });
    if (!config?.channels?.length) return [];

    let unjoined = [];
    
    for (const ch of config.channels) {
        try {
            // IF PRIVATE CHANNEL: Try to approve join request first
            if (ch.type === 'private') {
                try {
                    await ctx.telegram.approveChatJoinRequest(ch.id, ctx.from.id);
                } catch (e) {
                    // Ignore error (Start parameter missing or no request found)
                }
            }

            const member = await ctx.telegram.getChatMember(ch.id, ctx.from.id);
            if (['left', 'kicked', 'restricted'].includes(member.status)) {
                unjoined.push(ch);
            }
        } catch (e) {
            // If bot can't check (not admin), assume unjoined or ignore?
            // Safer to assume unjoined so user is prompted, but if error is "Chat not found", skip
            console.log(`Error checking channel ${ch.id}:`, e.message);
            unjoined.push(ch); 
        }
    }
    return unjoined;
}

// ==========================================
// USER FLOW
// ==========================================

bot.start(async (ctx) => {
    // Save User
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

    await checkChannelsAndSendMenu(ctx);
});

async function checkChannelsAndSendMenu(ctx) {
    const config = await db.collection('settings').findOne({ type: 'config' });
    const unjoined = await getUnjoinedChannels(ctx);

    // --- PHASE 1: NOT JOINED (SHOW CHANNELS) ---
    if (unjoined.length > 0) {
        const imageUrl = getImageUrl(config.startImage, ctx.from);
        const caption = replaceVariables(config.startMessage, ctx.from);

        // Inline Buttons for Channels
        const channelButtons = unjoined.map(ch => [
            Markup.button.url(ch.buttonLabel || 'Join Channel', ch.link)
        ]);

        // Reply Keyboard for Verify
        const replyKeyboard = Markup.keyboard([
            ['✅ Verify Joined']
        ]).resize();

        // Send Message
        try {
            await ctx.replyWithPhoto(imageUrl, {
                caption: caption,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: channelButtons }
            });
            await ctx.reply("👇 Click below after joining:", replyKeyboard);
        } catch (e) {
            // Fallback if image fails
            await ctx.reply(caption, { 
                parse_mode: 'Markdown', 
                reply_markup: { inline_keyboard: channelButtons } 
            });
            await ctx.reply("👇 Click below after joining:", replyKeyboard);
        }
        return;
    }

    // --- PHASE 2: VERIFIED (SHOW APPS MENU) ---
    
    // Check if cooldown allows viewing (Optional: usually cooldown is for generation, not viewing)
    // We proceed to show apps.

    const imageUrl = getImageUrl(config.menuImage, ctx.from);
    const caption = replaceVariables(config.menuMessage, ctx.from);
    
    // Generate App Buttons for Reply Keyboard
    // Arrange in 2 columns
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

    if (await isAdmin(ctx.from.id)) {
        keyboardRows.push(['/adminpanel']);
    }

    await ctx.replyWithPhoto(imageUrl, {
        caption: caption,
        parse_mode: 'Markdown'
    });
    
    await ctx.reply("📱 Choose an App:", Markup.keyboard(keyboardRows).resize());
}

// HANDLE APP SELECTION (TEXT TRIGGER)
bot.on('text', async (ctx, next) => {
    // If command, skip
    if (ctx.message.text.startsWith('/')) return next();
    if (['✅ Verify Joined', '🔙 Back'].includes(ctx.message.text)) return next();

    const config = await db.collection('settings').findOne({ type: 'config' });
    const app = config.apps?.find(a => a.name === ctx.message.text);

    if (!app) return next(); // Not an app button

    // --- COOLDOWN CHECK ---
    const user = await db.collection('users').findOne({ id: ctx.from.id });
    const now = Date.now();
    const cooldownMs = (config.cooldownMinutes || 120) * 60 * 1000;
    
    if (user.lastClaim && (now - user.lastClaim < cooldownMs)) {
        const remainingMs = cooldownMs - (now - user.lastClaim);
        const remainingMins = Math.ceil(remainingMs / 60000);
        return ctx.reply(`⏳ *Cooldown Active*\n\nPlease wait ${remainingMins} minutes before generating another code for any app.`, { parse_mode: 'Markdown' });
    }

    // --- GENERATE CODE & REPLY ---
    
    // Update Cooldown
    await db.collection('users').updateOne(
        { id: ctx.from.id }, 
        { $set: { lastClaim: now } }
    );

    const imageUrl = app.image || config.menuImage;
    const message = replaceVariables(app.message, ctx.from, app);

    await ctx.replyWithPhoto(imageUrl, {
        caption: message,
        parse_mode: 'Markdown'
    });
    
    // Send Back Button
    await ctx.reply("Tap to go back:", Markup.keyboard([['🔙 Back']]).resize());
});

// ==========================================
// 🛡️ ADMIN PANEL SCENES & LOGIC
// ==========================================

const admin_scene = new Scenes.BaseScene('admin_scene');

bot.command('adminpanel', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    await ctx.scene.enter('admin_scene');
});

admin_scene.enter(async (ctx) => {
    await sendAdminMenu(ctx);
});

async function sendAdminMenu(ctx) {
    const txt = "👮‍♂️ *Admin Panel*\n\nSelect an option:";
    const kb = [
        [{ text: '🖼 Set Start Image', callback_data: 'set_start_img' }, { text: '📝 Set Start Msg', callback_data: 'set_start_msg' }],
        [{ text: '🖼 Set Menu Image', callback_data: 'set_menu_img' }, { text: '📝 Set Menu Msg', callback_data: 'set_menu_msg' }],
        [{ text: '📺 Manage Channels', callback_data: 'manage_channels' }, { text: '📱 Manage Apps', callback_data: 'manage_apps' }],
        [{ text: '⏱ Set Cooldown', callback_data: 'set_timer' }],
        [{ text: '📢 Broadcast', callback_data: 'broadcast' }],
        [{ text: '❌ Close', callback_data: 'close_admin' }]
    ];
    
    // Safe edit/reply
    if (ctx.callbackQuery) {
        await ctx.editMessageText(txt, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(e=>ctx.replyWithMarkdown(txt, { reply_markup: { inline_keyboard: kb } }));
    } else {
        await ctx.replyWithMarkdown(txt, { reply_markup: { inline_keyboard: kb } });
    }
}

admin_scene.action('close_admin', ctx => ctx.scene.leave());

// --- GENERIC WIZARD HANDLER ---
function createInputScene(sceneId, prompt, updateField) {
    const s = new Scenes.BaseScene(sceneId);
    s.enter(ctx => ctx.reply(prompt, Markup.inlineKeyboard([Markup.button.callback('Cancel', 'cancel')])));
    s.action('cancel', async ctx => { await ctx.answerCbQuery(); await ctx.scene.leave(); await ctx.scene.enter('admin_scene'); });
    s.on('text', async ctx => {
        const val = ctx.message.text;
        await db.collection('settings').updateOne({ type: 'config' }, { $set: { [updateField]: val } });
        await ctx.reply(`✅ Updated ${updateField}`);
        await ctx.scene.leave();
        await ctx.scene.enter('admin_scene');
    });
    return s;
}

stage.register(
    createInputScene('set_start_img_s', "Send new Start Image URL (You can use {name}):", 'startImage'),
    createInputScene('set_start_msg_s', "Send new Start Message (Variables: {first_name}, {username}):", 'startMessage'),
    createInputScene('set_menu_img_s', "Send new Menu Image URL:", 'menuImage'),
    createInputScene('set_menu_msg_s', "Send new Menu Message:", 'menuMessage'),
    createInputScene('set_timer_s', "Send Cooldown time in Minutes (e.g., 120):", 'cooldownMinutes')
);

admin_scene.action('set_start_img', ctx => ctx.scene.enter('set_start_img_s'));
admin_scene.action('set_start_msg', ctx => ctx.scene.enter('set_start_msg_s'));
admin_scene.action('set_menu_img', ctx => ctx.scene.enter('set_menu_img_s'));
admin_scene.action('set_menu_msg', ctx => ctx.scene.enter('set_menu_msg_s'));
admin_scene.action('set_timer', ctx => ctx.scene.enter('set_timer_s'));

// --- MANAGE CHANNELS SCENE ---
const manage_channels_scene = new Scenes.BaseScene('manage_channels_scene');
stage.register(manage_channels_scene);

admin_scene.action('manage_channels', ctx => ctx.scene.enter('manage_channels_scene'));

manage_channels_scene.enter(async ctx => {
    const config = await db.collection('settings').findOne({ type: 'config' });
    const chans = config.channels || [];
    
    let kb = chans.map(c => [{ text: `🗑 Del ${c.buttonLabel}`, callback_data: `del_c_${c.id}` }]);
    kb.push([{ text: '➕ Add Public Channel', callback_data: 'add_public' }]);
    kb.push([{ text: '➕ Add Private Channel', callback_data: 'add_private' }]);
    kb.push([{ text: '🔙 Back', callback_data: 'back' }]);

    await ctx.editMessageText("📺 *Manage Channels*", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(e => ctx.reply("Manage Channels", { reply_markup: { inline_keyboard: kb } }));
});

manage_channels_scene.action('back', ctx => ctx.scene.enter('admin_scene'));
manage_channels_scene.action(/^del_c_(.+)$/, async ctx => {
    const id = ctx.match[1];
    await db.collection('settings').updateOne({ type: 'config' }, { $pull: { channels: { id: parseInt(id) } } });
    await ctx.answerCbQuery("Deleted");
    ctx.scene.reenter();
});

// Add Channel Wizard
const add_channel_wizard = new Scenes.WizardScene(
    'add_channel_wizard',
    async (ctx) => {
        const type = ctx.scene.state.type; // public or private
        await ctx.reply(`1️⃣ Enter Button Name for ${type} channel:`);
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.name = ctx.message.text;
        if (ctx.scene.state.type === 'public') {
            await ctx.reply("2️⃣ Send Channel Username (e.g. @mychan) or Forward a message from it:");
            return ctx.wizard.next();
        } else {
            await ctx.reply("2️⃣ Send Private Channel ID (e.g. -100123456789):");
            return ctx.wizard.selectStep(3); // Skip to private specific step
        }
    },
    // Public Step
    async (ctx) => {
        let chat;
        try {
            if (ctx.message.forward_from_chat) chat = ctx.message.forward_from_chat;
            else chat = await ctx.telegram.getChat(ctx.message.text);
            
            const link = `https://t.me/${chat.username}`;
            await saveChannel(chat.id, chat.title, link, ctx.scene.state.name, 'public');
            await ctx.reply("✅ Public Channel Added!");
            return ctx.scene.enter('manage_channels_scene');
        } catch (e) {
            await ctx.reply("❌ Error finding channel. Ensure bot is admin. Try again.");
            return;
        }
    },
    // Private Step ID
    async (ctx) => {
        ctx.scene.state.id = parseInt(ctx.message.text);
        await ctx.reply("3️⃣ Send Private Join Link:");
        return ctx.wizard.next();
    },
    // Private Step Link
    async (ctx) => {
        await saveChannel(ctx.scene.state.id, "Private Channel", ctx.message.text, ctx.scene.state.name, 'private');
        await ctx.reply("✅ Private Channel Added!");
        return ctx.scene.enter('manage_channels_scene');
    }
);

async function saveChannel(id, title, link, label, type) {
    await db.collection('settings').updateOne(
        { type: 'config' },
        { $push: { channels: { id, title, link, buttonLabel: label, type } } }
    );
}

stage.register(add_channel_wizard);

manage_channels_scene.action('add_public', ctx => ctx.scene.enter('add_channel_wizard', { type: 'public' }));
manage_channels_scene.action('add_private', ctx => ctx.scene.enter('add_channel_wizard', { type: 'private' }));


// --- MANAGE APPS SCENE ---
const manage_apps_scene = new Scenes.BaseScene('manage_apps_scene');
stage.register(manage_apps_scene);

admin_scene.action('manage_apps', ctx => ctx.scene.enter('manage_apps_scene'));

manage_apps_scene.enter(async ctx => {
    const config = await db.collection('settings').findOne({ type: 'config' });
    const apps = config.apps || [];
    
    let kb = apps.map(a => [{ text: `✏️ ${a.name}`, callback_data: `edit_app_${a.name}` }, { text: `🗑`, callback_data: `del_app_${a.name}` }]);
    kb.push([{ text: '➕ Add New App', callback_data: 'add_app' }]);
    kb.push([{ text: '🔙 Back', callback_data: 'back' }]);

    await ctx.editMessageText("📱 *Manage Apps*", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: kb } }).catch(e => ctx.reply("Manage Apps", { reply_markup: { inline_keyboard: kb } }));
});

manage_apps_scene.action('back', ctx => ctx.scene.enter('admin_scene'));
manage_apps_scene.action(/^del_app_(.+)$/, async ctx => {
    await db.collection('settings').updateOne({ type: 'config' }, { $pull: { apps: { name: ctx.match[1] } } });
    await ctx.answerCbQuery("Deleted");
    ctx.scene.reenter();
});

// Add App Wizard
const add_app_wizard = new Scenes.WizardScene(
    'add_app_wizard',
    async (ctx) => {
        await ctx.reply("1️⃣ Enter **App Name** (Keyboard Button Text):");
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.name = ctx.message.text;
        await ctx.reply("2️⃣ Enter **Image URL** for this app:");
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.image = ctx.message.text;
        await ctx.reply("3️⃣ Enter **Code Prefix** (e.g. 'PUBG'):");
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.prefix = ctx.message.text;
        await ctx.reply("4️⃣ Enter **Total Code Length** (e.g. 12):");
        return ctx.wizard.next();
    },
    async (ctx) => {
        ctx.scene.state.len = parseInt(ctx.message.text);
        await ctx.reply("5️⃣ Enter **Message**.\nUse variables: `{code1}`, `{code2}`, `{app_name}`:");
        return ctx.wizard.next();
    },
    async (ctx) => {
        const app = {
            name: ctx.scene.state.name,
            image: ctx.scene.state.image,
            codePrefix: ctx.scene.state.prefix,
            codeLength: ctx.scene.state.len,
            message: ctx.message.text
        };
        await db.collection('settings').updateOne({ type: 'config' }, { $push: { apps: app } });
        await ctx.reply("✅ App Added Successfully!");
        return ctx.scene.enter('manage_apps_scene');
    }
);
stage.register(add_app_wizard);
manage_apps_scene.action('add_app', ctx => ctx.scene.enter('add_app_wizard'));

// --- BROADCAST ---
const broadcast_scene = new Scenes.BaseScene('broadcast_s');
stage.register(broadcast_scene);
admin_scene.action('broadcast', ctx => { ctx.reply("Send message to broadcast:"); return ctx.scene.enter('broadcast_s'); });

broadcast_scene.on('message', async ctx => {
    const users = await db.collection('users').find({}).toArray();
    await ctx.reply(`🚀 Sending to ${users.length} users...`);
    let count = 0;
    for (const u of users) {
        try {
            await ctx.telegram.copyMessage(u.id, ctx.chat.id, ctx.message.message_id);
            count++;
            await new Promise(r => setTimeout(r, 35)); // Rate limit
        } catch (e) {}
    }
    await ctx.reply(`✅ Sent to ${count} users.`);
    await ctx.scene.leave();
    await ctx.scene.enter('admin_scene');
});

// ==========================================
// STARTUP
// ==========================================

// Handle Railway/Web Port
const PORT = process.env.PORT || 3000;
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('Bot Active'));
app.listen(PORT, () => {
    connectDB().then(() => {
        initBot().then(() => {
            bot.launch();
            console.log('🤖 Bot Launched!');
        });
    });
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
