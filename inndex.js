// ==========================================
// CONFIGURATION & SETUP
// ==========================================

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { MongoClient } = require('mongodb');
require('dotenv').config();

// Initialize bot
const token = "8157925136:AAFPNIG6ipDPyAnwqc9cgIvBa2pcqVDfrW8";
const bot = new Telegraf(token);

// MongoDB connection
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

// Scene initialization
const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

// Scene handler factory
function answerHandler(sceneId) {
    return new Scenes.BaseScene(sceneId);
}

// All scenes
const scenes = {
    // Admin scenes
    broadcast_scene: answerHandler('broadcast_scene'),
    set_start_image_scene: answerHandler('set_start_image_scene'),
    set_start_message_scene: answerHandler('set_start_message_scene'),
    set_menu_image_scene: answerHandler('set_menu_image_scene'),
    set_menu_message_scene: answerHandler('set_menu_message_scene'),
    add_chan_scene: answerHandler('add_chan_scene'),
    edit_chan_scene: answerHandler('edit_chan_scene'),
    add_app_scene: answerHandler('add_app_scene'),
    edit_app_scene: answerHandler('edit_app_scene'),
    set_timer_scene: answerHandler('set_timer_scene'),
    edit_app_code_scene: answerHandler('edit_app_code_scene'),
    
    // User scenes
    verify_channels_scene: answerHandler('verify_channels_scene')
};

// Register all scenes
Object.values(scenes).forEach(scene => stage.register(scene));

// 🔐 ADMIN CONFIGURATION
const ADMIN_IDS = [8435248854];

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

async function initBot() {
    try {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { 
                $setOnInsert: { 
                    type: 'config',
                    admins: ADMIN_IDS,
                    channels: [],
                    apps: [],
                    startImage: 'https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:{name},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg',
                    startMessage: '👋 *Welcome! We are Premium Agents.*\n\n⚠️ _Access Denied_\nTo access our exclusive agent list, you must join our affiliate channels below:',
                    menuImage: 'https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:{name},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg',
                    menuMessage: '🎉 *Welcome to the Agent Panel!*\n\n✅ _Verification Successful_\nSelect an app below to generate codes:',
                    codeTimer: 7200 // 2 hours in seconds
                }
            },
            { upsert: true }
        );
        console.log(`✅ Bot initialized. Admins: ${ADMIN_IDS.length}`);
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
        } catch (e) {}
    }
}

// 🧠 SMART NAME LOGIC
function getSanitizedName(user) {
    let rawFirst = user.first_name || "";
    let cleanFirst = rawFirst.replace(/[^\w\s]/gi, "").trim();
    
    let rawUser = user.username || "";
    let cleanUser = rawUser.replace(/[^\w\s]/gi, "").trim();
    
    if (cleanFirst.length > 0 && cleanFirst.length <= 8) return cleanFirst;
    if (cleanUser.length > 0 && (cleanUser.length < cleanFirst.length || cleanFirst.length === 0)) return cleanUser;
    if (cleanFirst.length > 0) return cleanFirst;
    if (cleanUser.length > 0) return cleanUser;
    
    return "Agent";
}

// Format variables in text
function formatVariables(text, user, appName = '', codes = []) {
    if (!text) return '';
    
    let formatted = text
        .replace(/{full_name}/gi, `${user.first_name || ''} ${user.last_name || ''}`.trim())
        .replace(/{first_name}/gi, user.first_name || 'User')
        .replace(/{last_name}/gi, user.last_name || '')
        .replace(/{username}/gi, user.username ? `@${user.username}` : 'User')
        .replace(/{button_name}/gi, appName)
        .replace(/{app_name}/gi, appName);
    
    // Replace {code1} to {code10}
    for (let i = 1; i <= 10; i++) {
        if (codes[i-1]) {
            formatted = formatted.replace(new RegExp(`{code${i}}`, 'gi'), codes[i-1]);
        }
    }
    
    return formatted;
}

// Generate random alphanumeric code
function generateCode(prefix = '', length = 8) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = prefix;
    for (let i = code.length; i < length; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// Check Admin Status
async function isAdmin(userId) {
    if (ADMIN_IDS.includes(Number(userId))) return true;
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        return config?.admins?.some(id => String(id) === String(userId)) || false;
    } catch (e) { return false; }
}

// Get Unjoined Channels
async function getUnjoinedChannels(userId) {
    const config = await db.collection('admin').findOne({ type: 'config' });
    if (!config?.channels?.length) return [];
    
    let unjoined = [];
    for (const ch of config.channels) {
        try {
            if (ch.type === 'private') {
                unjoined.push(ch);
            } else {
                const member = await bot.telegram.getChatMember(ch.id, userId);
                if (['left', 'kicked', 'restricted'].includes(member.status)) {
                    unjoined.push(ch);
                }
            }
        } catch (e) {
            unjoined.push(ch);
        }
    }
    return unjoined;
}

// Check if user can generate code for app
async function canGenerateCode(userId, appId) {
    const userData = await db.collection('info').findOne({ user: userId });
    if (!userData?.codeTimestamps) return true;
    
    const appTimestamp = userData.codeTimestamps[appId];
    if (!appTimestamp) return true;
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const timer = config?.codeTimer || 7200;
    
    const elapsed = Math.floor((Date.now() - appTimestamp) / 1000);
    return elapsed >= timer;
}

// Get remaining time for code generation
async function getRemainingTime(userId, appId) {
    const userData = await db.collection('info').findOne({ user: userId });
    if (!userData?.codeTimestamps?.[appId]) return 0;
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const timer = config?.codeTimer || 7200;
    
    const elapsed = Math.floor((Date.now() - userData.codeTimestamps[appId]) / 1000);
    const remaining = timer - elapsed;
    return remaining > 0 ? remaining : 0;
}

// Format time
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

// ==========================================
// USER FLOW
// ==========================================

bot.start(async (ctx) => {
    try {
        const user = ctx.from;
        
        // Check for New User
        const existingUser = await db.collection('info').findOne({ user: user.id });
        
        if (!existingUser) {
            await db.collection('info').insertOne({
                user: user.id,
                firstName: user.first_name,
                username: user.username,
                lastName: user.last_name,
                joinedAll: false,
                joinedDate: new Date(),
                codeTimestamps: {}
            });
            
            // Notify Admin
            const userLink = user.username ? `@${user.username}` : user.first_name;
            await notifyAdmin(`🆕 *New User Joined*\nID: \`${user.id}\`\nUser: ${userLink}`);
        } else {
            await db.collection('info').updateOne(
                { user: user.id },
                { $set: { 
                    firstName: user.first_name, 
                    username: user.username,
                    lastName: user.last_name,
                    lastActive: new Date() 
                } }
            );
        }

        await showStartScreen(ctx);
    } catch (e) {
        console.error(e);
    }
});

async function showStartScreen(ctx) {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config?.channels || [];
    
    if (channels.length === 0) {
        // No channels set, show direct menu
        await showMenu(ctx);
        return;
    }
    
    // Check if already joined all channels
    const unjoined = await getUnjoinedChannels(ctx.from.id);
    if (unjoined.length === 0) {
        await showMenu(ctx);
        return;
    }
    
    // Get start image and message
    const startImage = config?.startImage || '';
    const startMessage = config?.startMessage || '👋 *Welcome!*\n\nJoin our channels to continue:';
    
    const cleanName = getSanitizedName(ctx.from);
    const imageUrl = startImage.replace(/{name}/gi, encodeURIComponent(cleanName));
    
    // Create channel buttons as keyboard
    const channelButtons = channels.map(ch => [{ text: `Join ${ch.buttonLabel}` }]);
    channelButtons.push([{ text: '✅ Verify All Channels' }]);
    
    try {
        await ctx.replyWithPhoto(imageUrl, {
            caption: formatVariables(startMessage, ctx.from),
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: channelButtons,
                resize_keyboard: true
            }
        });
    } catch (e) {
        await ctx.reply(formatVariables(startMessage, ctx.from), {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: channelButtons,
                resize_keyboard: true
            }
        });
    }
}

// Handle channel join buttons
bot.hears(/^Join (.+)$/, async (ctx) => {
    const buttonName = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channel = config?.channels?.find(c => c.buttonLabel === buttonName);
    
    if (channel) {
        await ctx.reply(`Click to join: ${channel.link}`);
    } else {
        await ctx.reply('Channel not found');
    }
});

// Verify all channels button
bot.hears('✅ Verify All Channels', async (ctx) => {
    const unjoined = await getUnjoinedChannels(ctx.from.id);
    
    if (unjoined.length === 0) {
        // All channels joined
        const userInfo = await db.collection('info').findOne({ user: ctx.from.id });
        if (!userInfo?.joinedAll) {
            await db.collection('info').updateOne(
                { user: ctx.from.id },
                { $set: { joinedAll: true } }
            );
            
            const userLink = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
            await notifyAdmin(`✅ *User Joined All Channels*\nID: \`${ctx.from.id}\`\nUser: ${userLink}`);
        }
        
        await showMenu(ctx);
    } else {
        await ctx.reply(`❌ Still ${unjoined.length} channels to join. Please join all channels first.`);
        await showStartScreen(ctx);
    }
});

async function showMenu(ctx) {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    // Get menu image and message
    const menuImage = config?.menuImage || config?.startImage || '';
    const menuMessage = config?.menuMessage || '🎉 *Welcome to the Agent Panel!*\n\nSelect an app below:';
    
    const cleanName = getSanitizedName(ctx.from);
    const imageUrl = menuImage.replace(/{name}/gi, encodeURIComponent(cleanName));
    
    // Create keyboard with app buttons
    const keyboard = [];
    apps.forEach(app => {
        keyboard.push([{ text: app.name }]);
    });
    keyboard.push([{ text: '🔙 Back' }]);
    
    try {
        if (menuImage) {
            await ctx.replyWithPhoto(imageUrl, {
                caption: formatVariables(menuMessage, ctx.from),
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true
                }
            });
        } else {
            await ctx.reply(formatVariables(menuMessage, ctx.from), {
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: keyboard,
                    resize_keyboard: true
                }
            });
        }
    } catch (e) {
        await ctx.reply(formatVariables(menuMessage, ctx.from), {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true
            }
        });
    }
}

// Handle back button
bot.hears('🔙 Back', async (ctx) => {
    await showStartScreen(ctx);
});

// Handle app selection
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    // Skip if it's a command or already handled
    if (text.startsWith('/') || text === '🔙 Back' || text.startsWith('Join ') || text === '✅ Verify All Channels') {
        return;
    }
    
    // Check if it's an app name
    const config = await db.collection('admin').findOne({ type: 'config' });
    const app = config?.apps?.find(a => a.name === text);
    
    if (app) {
        await handleAppSelection(ctx, app);
    }
});

async function handleAppSelection(ctx, app) {
    const userId = ctx.from.id;
    const canGenerate = await canGenerateCode(userId, app.id);
    
    if (!canGenerate) {
        const remaining = await getRemainingTime(userId, app.id);
        await ctx.reply(
            `⏳ Please wait ${formatTime(remaining)} before generating new codes for ${app.name}`,
            Markup.keyboard([['🔙 Back']]).resize()
        );
        return;
    }
    
    // Generate codes
    const codes = [];
    for (let i = 0; i < app.codeCount; i++) {
        const prefix = app.codePrefixes?.[i] || '';
        const length = app.codeLengths?.[i] || 8;
        codes.push(generateCode(prefix, length));
    }
    
    // Format message
    let message = formatVariables(app.codeMessage, ctx.from, app.name, codes);
    
    // Send app image if exists
    const keyboard = Markup.keyboard([['🔙 Back']]).resize();
    
    if (app.image) {
        try {
            await ctx.replyWithPhoto(app.image, {
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } catch (e) {
            await ctx.reply(message, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    } else {
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    }
    
    // Update user's code timestamp
    await db.collection('info').updateOne(
        { user: userId },
        { $set: { [`codeTimestamps.${app.id}`]: Date.now() } }
    );
}

// ==========================================
// 🛡️ ADMIN PANEL
// ==========================================

bot.command('adminpanel', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) {
        await ctx.reply("❌ You are not authorized to access admin panel.");
        return;
    }
    
    const text = "👮‍♂️ *Admin Control Panel*\n\nSelect an option below:";
    const keyboard = [
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '👥 User Stats', callback_data: 'admin_userdata' }],
        [{ text: '🖼️ Start Image', callback_data: 'admin_start_image' }],
        [{ text: '📝 Start Message', callback_data: 'admin_start_message' }],
        [{ text: '🖼️ Menu Image', callback_data: 'admin_menu_image' }],
        [{ text: '📝 Menu Message', callback_data: 'admin_menu_message' }],
        [{ text: '⏰ Code Timer', callback_data: 'admin_timer' }],
        [{ text: '📺 Manage Channels', callback_data: 'admin_channels' }],
        [{ text: '📱 Manage Apps', callback_data: 'admin_apps' }]
    ];
    
    await ctx.replyWithMarkdown(text, { 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Back button handler for admin
bot.action('admin_back', async (ctx) => {
    await ctx.deleteMessage();
    const text = "👮‍♂️ *Admin Control Panel*\n\nSelect an option below:";
    const keyboard = [
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '👥 User Stats', callback_data: 'admin_userdata' }],
        [{ text: '🖼️ Start Image', callback_data: 'admin_start_image' }],
        [{ text: '📝 Start Message', callback_data: 'admin_start_message' }],
        [{ text: '🖼️ Menu Image', callback_data: 'admin_menu_image' }],
        [{ text: '📝 Menu Message', callback_data: 'admin_menu_message' }],
        [{ text: '⏰ Code Timer', callback_data: 'admin_timer' }],
        [{ text: '📺 Manage Channels', callback_data: 'admin_channels' }],
        [{ text: '📱 Manage Apps', callback_data: 'admin_apps' }]
    ];
    
    await ctx.replyWithMarkdown(text, { 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// 1. Start Image Management
bot.action('admin_start_image', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentImage = config?.startImage || 'Not set';
    
    const text = `🖼️ *Start Image Management*\n\nCurrent: ${currentImage}\n\nSelect an option:`;
    const keyboard = [
        [{ text: '📤 Set/Change Image', callback_data: 'set_start_image' }],
        [{ text: '🗑️ Delete Image', callback_data: 'delete_start_image' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action('set_start_image', async (ctx) => {
    await ctx.reply("🖼️ *Set Start Image*\n\nSend an image URL with {name} variable for username\nOr send a photo directly\n\nType 'cancel' to cancel", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_start_image_scene');
});

bot.action('delete_start_image', async (ctx) => {
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { startImage: '' } }
    );
    await ctx.answerCbQuery('✅ Start image deleted!');
    await ctx.editMessageText('✅ Start image deleted successfully!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_start_image' }]] }
    });
});

scenes.set_start_image_scene.on('message', async (ctx) => {
    if (ctx.message.text?.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    let imageUrl;
    if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    } else if (ctx.message.text) {
        imageUrl = ctx.message.text.trim();
    } else {
        await ctx.reply("❌ Please send a valid URL or photo.");
        return ctx.scene.leave();
    }
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { startImage: imageUrl } }
    );
    await ctx.reply("✅ Start image updated!");
    await ctx.scene.leave();
});

// 2. Start Message Management
bot.action('admin_start_message', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentMessage = config?.startMessage || 'Not set';
    
    const text = `📝 *Start Message Management*\n\nCurrent:\n${currentMessage}\n\nAvailable variables:\n{first_name}, {last_name}, {full_name}, {username}, {name}\n\nSelect an option:`;
    const keyboard = [
        [{ text: '✏️ Edit Message', callback_data: 'edit_start_message' }],
        [{ text: '🗑️ Reset to Default', callback_data: 'reset_start_message' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action('edit_start_message', async (ctx) => {
    await ctx.reply("📝 *Edit Start Message*\n\nSend the new start message:\n\nAvailable variables:\n{first_name}, {last_name}, {full_name}, {username}, {name}", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_start_message_scene');
});

bot.action('reset_start_message', async (ctx) => {
    const defaultMessage = '👋 *Welcome! We are Premium Agents.*\n\n⚠️ _Access Denied_\nTo access our exclusive agent list, you must join our affiliate channels below:';
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { startMessage: defaultMessage } }
    );
    await ctx.answerCbQuery('✅ Reset to default!');
    await ctx.editMessageText('✅ Start message reset to default!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_start_message' }]] }
    });
});

scenes.set_start_message_scene.on('text', async (ctx) => {
    if (ctx.message.text.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { startMessage: ctx.message.text } }
    );
    await ctx.reply("✅ Start message updated!");
    await ctx.scene.leave();
});

// 3. Menu Image Management
bot.action('admin_menu_image', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentImage = config?.menuImage || 'Not set';
    
    const text = `🖼️ *Menu Image Management*\n\nCurrent: ${currentImage}\n\nSelect an option:`;
    const keyboard = [
        [{ text: '📤 Set/Change Image', callback_data: 'set_menu_image' }],
        [{ text: '🗑️ Delete Image', callback_data: 'delete_menu_image' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action('set_menu_image', async (ctx) => {
    await ctx.reply("🖼️ *Set Menu Image*\n\nSend an image URL with {name} variable for username\nOr send a photo directly\n\nType 'cancel' to cancel", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_menu_image_scene');
});

bot.action('delete_menu_image', async (ctx) => {
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { menuImage: '' } }
    );
    await ctx.answerCbQuery('✅ Menu image deleted!');
    await ctx.editMessageText('✅ Menu image deleted successfully!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_menu_image' }]] }
    });
});

scenes.set_menu_image_scene.on('message', async (ctx) => {
    if (ctx.message.text?.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    let imageUrl;
    if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const file = await ctx.telegram.getFile(photo.file_id);
        imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
    } else if (ctx.message.text) {
        imageUrl = ctx.message.text.trim();
    } else {
        await ctx.reply("❌ Please send a valid URL or photo.");
        return ctx.scene.leave();
    }
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { menuImage: imageUrl } }
    );
    await ctx.reply("✅ Menu image updated!");
    await ctx.scene.leave();
});

// 4. Menu Message Management
bot.action('admin_menu_message', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentMessage = config?.menuMessage || 'Not set';
    
    const text = `📝 *Menu Message Management*\n\nCurrent:\n${currentMessage}\n\nAvailable variables:\n{first_name}, {last_name}, {full_name}, {username}, {name}\n\nSelect an option:`;
    const keyboard = [
        [{ text: '✏️ Edit Message', callback_data: 'edit_menu_message' }],
        [{ text: '🗑️ Reset to Default', callback_data: 'reset_menu_message' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action('edit_menu_message', async (ctx) => {
    await ctx.reply("📝 *Edit Menu Message*\n\nSend the new menu message:\n\nAvailable variables:\n{first_name}, {last_name}, {full_name}, {username}, {name}", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_menu_message_scene');
});

bot.action('reset_menu_message', async (ctx) => {
    const defaultMessage = '🎉 *Welcome to the Agent Panel!*\n\n✅ _Verification Successful_\nSelect an app below to generate codes:';
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { menuMessage: defaultMessage } }
    );
    await ctx.answerCbQuery('✅ Reset to default!');
    await ctx.editMessageText('✅ Menu message reset to default!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_menu_message' }]] }
    });
});

scenes.set_menu_message_scene.on('text', async (ctx) => {
    if (ctx.message.text.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { menuMessage: ctx.message.text } }
    );
    await ctx.reply("✅ Menu message updated!");
    await ctx.scene.leave();
});

// 5. Timer Management
bot.action('admin_timer', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentTimer = config?.codeTimer || 7200;
    const hours = Math.floor(currentTimer / 3600);
    const minutes = Math.floor((currentTimer % 3600) / 60);
    
    const text = `⏰ *Code Timer Management*\n\nCurrent: ${hours} hour(s) ${minutes} minute(s)\n\nSelect an option:`;
    const keyboard = [
        [{ text: '✏️ Edit Timer', callback_data: 'edit_timer' }],
        [{ text: '🔄 Reset to Default (2h)', callback_data: 'reset_timer' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action('edit_timer', async (ctx) => {
    await ctx.reply("⏰ *Set Code Timer*\n\nEnter time in hours (e.g., 2 for 2 hours):", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_timer_scene');
});

bot.action('reset_timer', async (ctx) => {
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { codeTimer: 7200 } }
    );
    await ctx.answerCbQuery('✅ Timer reset to 2 hours!');
    await ctx.editMessageText('✅ Timer reset to 2 hours!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_timer' }]] }
    });
});

scenes.set_timer_scene.on('text', async (ctx) => {
    if (ctx.message.text.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    const hours = parseFloat(ctx.message.text);
    if (isNaN(hours) || hours <= 0) {
        await ctx.reply("❌ Please enter a valid number of hours.");
        return ctx.scene.leave();
    }
    
    const seconds = Math.floor(hours * 3600);
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { codeTimer: seconds } }
    );
    await ctx.reply(`✅ Timer set to ${hours} hour(s) (${seconds} seconds)`);
    await ctx.scene.leave();
});

// 6. Channel Management
bot.action('admin_channels', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config?.channels || [];
    
    let text = "📺 *Channel Management*\n\n";
    if (channels.length === 0) {
        text += "No channels added yet.";
    } else {
        channels.forEach((ch, i) => {
            text += `${i+1}. ${ch.buttonLabel} (${ch.type})\n`;
        });
    }
    
    text += "\nSelect an option:";
    
    const keyboard = [
        [{ text: '➕ Add Channel', callback_data: 'add_channel' }]
    ];
    
    if (channels.length > 0) {
        keyboard.push([{ text: '✏️ Edit Channel', callback_data: 'edit_channel_list' }]);
        keyboard.push([{ text: '🗑️ Delete Channel', callback_data: 'delete_channel_list' }]);
    }
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Add Channel
bot.action('add_channel', async (ctx) => {
    await ctx.reply("📺 *Add Channel*\n\nSelect channel type:", {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🌐 Public Channel', callback_data: 'add_public_chan' }],
                [{ text: '🔒 Private Channel', callback_data: 'add_private_chan' }],
                [{ text: '🔙 Back', callback_data: 'admin_channels' }]
            ]
        }
    });
});

bot.action('add_public_chan', async (ctx) => {
    await ctx.reply("Enter channel button name:");
    await ctx.scene.enter('add_chan_scene', { type: 'public' });
});

bot.action('add_private_chan', async (ctx) => {
    await ctx.reply("Enter channel button name:");
    await ctx.scene.enter('add_chan_scene', { type: 'private' });
});

// Edit Channel List
bot.action('edit_channel_list', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config?.channels || [];
    
    let text = "✏️ *Select Channel to Edit*\n\n";
    const keyboard = [];
    
    channels.forEach((ch, i) => {
        keyboard.push([{ text: `${i+1}. ${ch.buttonLabel}`, callback_data: `edit_chan_${ch.id}` }]);
    });
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_channels' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Delete Channel List
bot.action('delete_channel_list', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config?.channels || [];
    
    let text = "🗑️ *Select Channel to Delete*\n\n";
    const keyboard = [];
    
    channels.forEach((ch, i) => {
        keyboard.push([{ text: `${i+1}. ${ch.buttonLabel}`, callback_data: `delete_chan_${ch.id}` }]);
    });
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_channels' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Handle edit/delete channel actions
bot.action(/^edit_chan_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channel = config.channels.find(c => c.id === channelId);
    
    if (!channel) {
        await ctx.answerCbQuery('Channel not found');
        return;
    }
    
    const text = `✏️ *Edit Channel*\n\nName: ${channel.buttonLabel}\nType: ${channel.type}\nLink: ${channel.link}\n\nSelect what to edit:`;
    const keyboard = [
        [{ text: '✏️ Edit Name', callback_data: `edit_chan_name_${channelId}` }],
        [{ text: '✏️ Edit Link', callback_data: `edit_chan_link_${channelId}` }],
        [{ text: '🔙 Back', callback_data: 'edit_channel_list' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action(/^delete_chan_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channel = config.channels.find(c => c.id === channelId);
    
    if (!channel) {
        await ctx.answerCbQuery('Channel not found');
        return;
    }
    
    const text = `🗑️ *Delete Channel*\n\nAre you sure you want to delete:\n${channel.buttonLabel}?`;
    const keyboard = [
        [{ text: '✅ Yes, Delete', callback_data: `confirm_delete_chan_${channelId}` }],
        [{ text: '❌ Cancel', callback_data: 'delete_channel_list' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action(/^confirm_delete_chan_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const newChannels = config.channels.filter(c => c.id !== channelId);
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { channels: newChannels } }
    );
    
    await ctx.answerCbQuery('✅ Channel deleted!');
    await ctx.editMessageText('✅ Channel deleted successfully!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_channels' }]] }
    });
});

// Add Channel Scene
scenes.add_chan_scene.on('text', async (ctx) => {
    if (!ctx.scene.state.buttonLabel) {
        ctx.scene.state.buttonLabel = ctx.message.text;
        ctx.scene.state.type = ctx.scene.state.type || 'public';
        
        if (ctx.scene.state.type === 'public') {
            await ctx.reply("Now send the Channel ID (-100...), Username (@name), or forward a message:");
        } else {
            await ctx.reply("Now send the Channel ID (-100...) or forward a message:");
        }
        return;
    }
    
    if (ctx.message.text?.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    let chatId;
    if (ctx.message.forward_from_chat) {
        chatId = ctx.message.forward_from_chat.id;
    } else if (ctx.message.text) {
        chatId = ctx.message.text.trim().replace('@', '');
    }
    
    try {
        const chat = await ctx.telegram.getChat(chatId);
        
        const channelData = {
            id: chat.id,
            title: chat.title,
            buttonLabel: ctx.scene.state.buttonLabel,
            type: ctx.scene.state.type
        };
        
        if (ctx.scene.state.type === 'public') {
            try {
                channelData.link = chat.username ? `https://t.me/${chat.username}` : await ctx.telegram.exportChatInviteLink(chat.id);
            } catch (e) {
                await ctx.reply("❌ Cannot get invite link. Make sure bot is admin.");
                return ctx.scene.leave();
            }
        } else {
            ctx.scene.state.chatData = channelData;
            await ctx.reply("Now send the Private Invite Link:");
            return;
        }
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { channels: channelData } }
        );
        await ctx.reply("✅ Channel added successfully!");
        await ctx.scene.leave();
        
    } catch (e) {
        await ctx.reply(`❌ Error: ${e.message}`);
        await ctx.scene.leave();
    }
});

scenes.add_chan_scene.on('text', async (ctx) => {
    if (ctx.scene.state.chatData && ctx.message.text) {
        const channelData = ctx.scene.state.chatData;
        channelData.link = ctx.message.text.trim();
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { channels: channelData } }
        );
        await ctx.reply("✅ Private channel added successfully!");
        await ctx.scene.leave();
    }
});

// 7. App Management
bot.action('admin_apps', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    let text = "📱 *App Management*\n\n";
    if (apps.length === 0) {
        text += "No apps added yet.";
    } else {
        apps.forEach((app, i) => {
            text += `${i+1}. ${app.name} (${app.codeCount} codes)\n`;
        });
    }
    
    text += "\nSelect an option:";
    
    const keyboard = [
        [{ text: '➕ Add App', callback_data: 'add_app' }]
    ];
    
    if (apps.length > 0) {
        keyboard.push([{ text: '✏️ Edit App', callback_data: 'edit_app_list' }]);
        keyboard.push([{ text: '🗑️ Delete App', callback_data: 'delete_app_list' }]);
        keyboard.push([{ text: '⚙️ Edit Code Settings', callback_data: 'edit_app_code_list' }]);
    }
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Add App
bot.action('add_app', async (ctx) => {
    await ctx.reply("📱 *Add New App*\n\nEnter app name:", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('add_app_scene');
});

// Edit App List
bot.action('edit_app_list', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    let text = "✏️ *Select App to Edit*\n\n";
    const keyboard = [];
    
    apps.forEach((app, i) => {
        keyboard.push([{ text: `${i+1}. ${app.name}`, callback_data: `edit_app_${app.id}` }]);
    });
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_apps' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Delete App List
bot.action('delete_app_list', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    let text = "🗑️ *Select App to Delete*\n\n";
    const keyboard = [];
    
    apps.forEach((app, i) => {
        keyboard.push([{ text: `${i+1}. ${app.name}`, callback_data: `delete_app_${app.id}` }]);
    });
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_apps' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Edit Code Settings List
bot.action('edit_app_code_list', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    let text = "⚙️ *Select App to Edit Code Settings*\n\n";
    const keyboard = [];
    
    apps.forEach((app, i) => {
        keyboard.push([{ text: `${i+1}. ${app.name}`, callback_data: `edit_app_code_${app.id}` }]);
    });
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_apps' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

// Handle edit/delete app actions
bot.action(/^edit_app_(.+)$/, async (ctx) => {
    const appId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const app = config.apps.find(a => a.id === appId);
    
    if (!app) {
        await ctx.answerCbQuery('App not found');
        return;
    }
    
    const text = `✏️ *Edit App*\n\nName: ${app.name}\nImage: ${app.image ? 'Set' : 'Not set'}\nCodes: ${app.codeCount}\n\nSelect what to edit:`;
    const keyboard = [
        [{ text: '✏️ Edit Name', callback_data: `edit_app_name_${appId}` }],
        [{ text: '🖼️ Edit Image', callback_data: `edit_app_image_${appId}` }],
        [{ text: '✏️ Edit Code Message', callback_data: `edit_app_message_${appId}` }],
        [{ text: '🔙 Back', callback_data: 'edit_app_list' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action(/^delete_app_(.+)$/, async (ctx) => {
    const appId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const app = config.apps.find(a => a.id === appId);
    
    if (!app) {
        await ctx.answerCbQuery('App not found');
        return;
    }
    
    const text = `🗑️ *Delete App*\n\nAre you sure you want to delete:\n${app.name}?`;
    const keyboard = [
        [{ text: '✅ Yes, Delete', callback_data: `confirm_delete_app_${appId}` }],
        [{ text: '❌ Cancel', callback_data: 'delete_app_list' }]
    ];
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action(/^edit_app_code_(.+)$/, async (ctx) => {
    const appId = ctx.match[1];
    await ctx.scene.enter('edit_app_code_scene', { appId: appId });
});

bot.action(/^confirm_delete_app_(.+)$/, async (ctx) => {
    const appId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const newApps = config.apps.filter(a => a.id !== appId);
    
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { apps: newApps } }
    );
    
    await ctx.answerCbQuery('✅ App deleted!');
    await ctx.editMessageText('✅ App deleted successfully!', {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_apps' }]] }
    });
});

// Add App Scene
scenes.add_app_scene.on('text', async (ctx) => {
    if (!ctx.scene.state.step) {
        // Step 1: App name
        ctx.scene.state.name = ctx.message.text;
        ctx.scene.state.step = 'image';
        await ctx.reply("Send app image URL (or send 'skip'):");
    } else if (ctx.scene.state.step === 'image') {
        if (ctx.message.text.toLowerCase() !== 'skip') {
            ctx.scene.state.image = ctx.message.text;
        }
        ctx.scene.state.step = 'codeCount';
        await ctx.reply("How many codes per generation? (1-10):");
    } else if (ctx.scene.state.step === 'codeCount') {
        const count = parseInt(ctx.message.text);
        if (isNaN(count) || count < 1 || count > 10) {
            await ctx.reply("Please enter a number between 1-10:");
            return;
        }
        ctx.scene.state.codeCount = count;
        ctx.scene.state.codePrefixes = [];
        ctx.scene.state.codeLengths = [];
        ctx.scene.state.currentCode = 1;
        ctx.scene.state.step = 'prefixes';
        await ctx.reply(`For code 1, enter prefix (e.g., XY) or 'none':`);
    } else if (ctx.scene.state.step === 'prefixes') {
        const current = ctx.scene.state.currentCode;
        const total = ctx.scene.state.codeCount;
        
        if (ctx.message.text.toLowerCase() === 'none') {
            ctx.scene.state.codePrefixes.push('');
        } else {
            ctx.scene.state.codePrefixes.push(ctx.message.text.toUpperCase());
        }
        
        if (current < total) {
            ctx.scene.state.currentCode++;
            await ctx.reply(`For code ${current + 1}, enter prefix (e.g., XY) or 'none':`);
        } else {
            ctx.scene.state.currentCode = 1;
            ctx.scene.state.step = 'lengths';
            await ctx.reply(`For code 1, enter total code length including prefix (min 6):`);
        }
    } else if (ctx.scene.state.step === 'lengths') {
        const current = ctx.scene.state.currentCode;
        const total = ctx.scene.state.codeCount;
        
        const length = parseInt(ctx.message.text);
        if (isNaN(length) || length < 6) {
            await ctx.reply(`Please enter valid length (min 6):`);
            return;
        }
        ctx.scene.state.codeLengths.push(length);
        
        if (current < total) {
            ctx.scene.state.currentCode++;
            await ctx.reply(`For code ${current + 1}, enter total code length including prefix (min 6):`);
        } else {
            ctx.scene.state.step = 'message';
            const variables = Array.from({length: total}, (_, i) => `{code${i+1}}`).join(', ');
            await ctx.reply(`Enter code message with variables:\n${variables}\n\nAlso available:\n{first_name}, {last_name}, {full_name}, {username}, {app_name}\n\nExample:\nGift card generated...\nApp: {app_name}\nCode: {code1}\nClaim fast!`);
        }
    } else if (ctx.scene.state.step === 'message') {
        const id = `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const newApp = {
            id: id,
            name: ctx.scene.state.name,
            image: ctx.scene.state.image || '',
            codeCount: ctx.scene.state.codeCount,
            codePrefixes: ctx.scene.state.codePrefixes,
            codeLengths: ctx.scene.state.codeLengths,
            codeMessage: ctx.message.text
        };
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { apps: newApp } }
        );
        
        await ctx.reply(`✅ App "${ctx.scene.state.name}" added successfully!`);
        await ctx.scene.leave();
    }
});

// Edit App Code Scene
scenes.edit_app_code_scene.on('text', async (ctx) => {
    if (!ctx.scene.state.step) {
        const appId = ctx.scene.state.appId;
        const config = await db.collection('admin').findOne({ type: 'config' });
        const app = config.apps.find(a => a.id === appId);
        
        if (!app) {
            await ctx.reply("App not found");
            return ctx.scene.leave();
        }
        
        ctx.scene.state.app = app;
        ctx.scene.state.step = 'select';
        
        let text = `⚙️ *Edit Code Settings for ${app.name}*\n\n`;
        text += `Current settings:\n`;
        text += `- Code count: ${app.codeCount}\n`;
        for (let i = 0; i < app.codeCount; i++) {
            text += `- Code ${i+1}: Prefix "${app.codePrefixes[i] || 'none'}", Length ${app.codeLengths[i]}\n`;
        }
        text += `\nSelect what to edit:`;
        
        const keyboard = [
            [{ text: '✏️ Edit Code Count', callback_data: 'edit_count' }],
            [{ text: '✏️ Edit Prefixes', callback_data: 'edit_prefixes' }],
            [{ text: '✏️ Edit Lengths', callback_data: 'edit_lengths' }],
            [{ text: '🔙 Back', callback_data: 'admin_apps' }]
        ];
        
        await ctx.reply(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
});

// Broadcast
bot.action('admin_broadcast', async (ctx) => {
    await ctx.reply("📢 Send message to broadcast (text, photo, or document):");
    await ctx.scene.enter('broadcast_scene');
});

scenes.broadcast_scene.on('message', async (ctx) => {
    const users = await db.collection('info').find({}).toArray();
    const total = users.length;
    let sent = 0;
    let failed = 0;
    
    await ctx.reply(`📤 Broadcasting to ${total} users...`);
    
    for (const user of users) {
        try {
            await ctx.telegram.copyMessage(user.user, ctx.chat.id, ctx.message.message_id);
            sent++;
            await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
        } catch (e) {
            failed++;
        }
    }
    
    await ctx.reply(`✅ Broadcast completed!\n\n📊 Sent: ${sent}\n❌ Failed: ${failed}`);
    await ctx.scene.leave();
});

// User Stats
bot.action('admin_userdata', async (ctx) => {
    const users = await db.collection('info').find({}).toArray();
    const total = users.length;
    const joined = users.filter(u => u.joinedAll).length;
    const activeToday = users.filter(u => {
        const lastActive = u.lastActive ? new Date(u.lastActive) : new Date(0);
        const today = new Date();
        return lastActive.toDateString() === today.toDateString();
    }).length;
    
    let text = `👥 *User Statistics*\n\n`;
    text += `📊 Total Users: ${total}\n`;
    text += `✅ Verified Users: ${joined}\n`;
    text += `📈 Active Today: ${activeToday}\n\n`;
    
    if (users.length > 0) {
        text += `*Recent Users:*\n`;
        users.slice(-10).forEach((user, i) => {
            const name = user.username ? `@${user.username}` : user.first_name || `User ${user.user}`;
            text += `${i+1}. ${name} - ${user.joinedAll ? '✅' : '❌'}\n`;
        });
    }
    
    await ctx.replyWithMarkdown(text, {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]] }
    });
});

// ==========================================
// START BOT
// ==========================================

async function startBot() {
    try {
        await connectDB();
        await initBot();
        await bot.launch();
        console.log('🤖 Bot is running...');
        
        process.once('SIGINT', () => bot.stop('SIGINT'));
        process.once('SIGTERM', () => bot.stop('SIGTERM'));
        
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

// Railway deployment setup
const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV === 'production') {
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
    startBot();
}

console.log("Bot Starting...");
