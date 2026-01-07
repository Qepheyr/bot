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
                // For private channels, we check if user has access via invite
                unjoined.push(ch); // We'll check join status differently
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
    const timer = config?.codeTimer || 7200; // Default 2 hours
    
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
    
    // Prepare keyboard with channel buttons
    const keyboard = channels.map(ch => [{ text: ch.buttonLabel, callback_data: `check_channel_${ch.id}` }]);
    keyboard.push([{ text: '✅ Verify All Channels', callback_data: 'verify_all_channels' }]);
    
    // Get start image and message
    const startImage = config?.startImage || '';
    const startMessage = config?.startMessage || '👋 *Welcome!*\n\nJoin our channels to continue:';
    
    const cleanName = getSanitizedName(ctx.from);
    const imageUrl = startImage.replace(/{name}/gi, encodeURIComponent(cleanName));
    
    try {
        await ctx.replyWithPhoto(imageUrl, {
            caption: formatVariables(startMessage, ctx.from),
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (e) {
        await ctx.reply(formatVariables(startMessage, ctx.from), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
}

// Check individual channel
bot.action(/^check_channel_(.+)$/, async (ctx) => {
    const channelId = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channel = config.channels.find(c => String(c.id) === String(channelId));
    
    if (!channel) {
        await ctx.answerCbQuery('Channel not found');
        return;
    }
    
    try {
        if (channel.type === 'private') {
            // For private channels, we show the invite link
            await ctx.reply(`Join this private channel: ${channel.link}`);
            await ctx.answerCbQuery('Check private channel link above');
        } else {
            const member = await bot.telegram.getChatMember(channel.id, ctx.from.id);
            if (['left', 'kicked', 'restricted'].includes(member.status)) {
                await ctx.reply(`You need to join: ${channel.link}`);
                await ctx.answerCbQuery('Please join the channel');
            } else {
                await ctx.answerCbQuery('✅ Channel joined!');
            }
        }
    } catch (e) {
        await ctx.answerCbQuery('Error checking channel');
    }
});

// Verify all channels
bot.action('verify_all_channels', async (ctx) => {
    const unjoined = await getUnjoinedChannels(ctx.from.id);
    
    if (unjoined.length === 0) {
        // All channels joined
        const userInfo = await db.collection('info').findOne({ user: ctx.from.id });
        if (!userInfo.joinedAll) {
            await db.collection('info').updateOne(
                { user: ctx.from.id },
                { $set: { joinedAll: true } }
            );
            
            const userLink = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;
            await notifyAdmin(`✅ *User Joined All Channels*\nID: \`${ctx.from.id}\`\nUser: ${userLink}`);
        }
        
        await showMenu(ctx);
    } else {
        // Some channels not joined
        await ctx.answerCbQuery(`❌ Still ${unjoined.length} channels to join`);
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
    const keyboard = apps.map(app => [{ text: app.name }]);
    keyboard.push([{ text: '🔙 Back' }]);
    
    try {
        await ctx.replyWithPhoto(imageUrl, {
            caption: formatVariables(menuMessage, ctx.from),
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
    } catch (e) {
        await ctx.reply(formatVariables(menuMessage, ctx.from), {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
    }
}

// Handle app selection
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    
    if (text === '🔙 Back') {
        await showStartScreen(ctx);
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
    
    // Replace code placeholders
    for (let i = 1; i <= 10; i++) {
        if (codes[i-1]) {
            message = message.replace(new RegExp(`{code${i}}`, 'gi'), codes[i-1]);
        }
    }
    
    // Send app image if exists
    if (app.image) {
        try {
            await ctx.replyWithPhoto(app.image, {
                caption: message,
                parse_mode: 'Markdown',
                reply_markup: Markup.keyboard([['🔙 Back']]).resize()
            });
        } catch (e) {
            await ctx.reply(message, {
                parse_mode: 'Markdown',
                reply_markup: Markup.keyboard([['🔙 Back']]).resize()
            });
        }
    } else {
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: Markup.keyboard([['🔙 Back']]).resize()
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
    if (!await isAdmin(ctx.from.id)) return;
    await sendAdminPanel(ctx);
});

async function sendAdminPanel(ctx) {
    const text = "👮‍♂️ *Admin Control Panel*\n\nSelect an option below:";
    const keyboard = [
        [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }],
        [{ text: '👥 User Stats', callback_data: 'admin_userdata' }],
        [{ text: '🖼️ Set Start Image', callback_data: 'admin_set_start_image' }],
        [{ text: '📝 Set Start Message', callback_data: 'admin_set_start_message' }],
        [{ text: '🖼️ Set Menu Image', callback_data: 'admin_set_menu_image' }],
        [{ text: '📝 Set Menu Message', callback_data: 'admin_set_menu_message' }],
        [{ text: '⏰ Set Code Timer', callback_data: 'admin_set_timer' }],
        [{ text: '📺 Manage Channels', callback_data: 'admin_channels' }],
        [{ text: '📱 Manage Apps', callback_data: 'admin_apps' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.replyWithMarkdown(text, { 
        reply_markup: { inline_keyboard: keyboard } 
    });
}

// Back button in admin panel
bot.action('admin_back', async (ctx) => {
    await ctx.deleteMessage();
    await sendAdminPanel(ctx);
});

// 1. Set Start Image
bot.action('admin_set_start_image', async (ctx) => {
    await ctx.reply("🖼️ *Set Start Image*\n\nSend an image URL with {name} variable for username\nOr send a photo directly\n\nType 'cancel' to cancel", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_start_image_scene');
});

scenes.set_start_image_scene.on('message', async (ctx) => {
    if (ctx.message.text?.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    let imageUrl;
    if (ctx.message.photo) {
        // Get the largest photo
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        imageUrl = await ctx.telegram.getFileLink(photo.file_id);
        imageUrl = imageUrl.href;
    } else if (ctx.message.text) {
        imageUrl = ctx.message.text.trim();
    }
    
    if (imageUrl) {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { startImage: imageUrl } }
        );
        await ctx.reply("✅ Start image updated!");
    } else {
        await ctx.reply("❌ Invalid image. Please send a valid URL or photo.");
    }
    
    await ctx.scene.leave();
});

// 2. Set Start Message
bot.action('admin_set_start_message', async (ctx) => {
    await ctx.reply(`📝 *Set Start Message*\n\nAvailable variables:\n{first_name} - User's first name\n{last_name} - User's last name\n{full_name} - Full name\n{username} - Username with @\n{name} - Short name\n\nCurrent message:\n${(await db.collection('admin').findOne({type:'config'})).startMessage}\n\nSend new message:`, {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_start_message_scene');
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

// 3. Set Menu Image
bot.action('admin_set_menu_image', async (ctx) => {
    await ctx.reply("🖼️ *Set Menu Image*\n\nSend an image URL with {name} variable for username\nOr send a photo directly\n\nType 'cancel' to cancel", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_menu_image_scene');
});

scenes.set_menu_image_scene.on('message', async (ctx) => {
    if (ctx.message.text?.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    let imageUrl;
    if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        imageUrl = await ctx.telegram.getFileLink(photo.file_id);
        imageUrl = imageUrl.href;
    } else if (ctx.message.text) {
        imageUrl = ctx.message.text.trim();
    }
    
    if (imageUrl) {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { menuImage: imageUrl } }
        );
        await ctx.reply("✅ Menu image updated!");
    } else {
        await ctx.reply("❌ Invalid image. Please send a valid URL or photo.");
    }
    
    await ctx.scene.leave();
});

// 4. Set Menu Message
bot.action('admin_set_menu_message', async (ctx) => {
    await ctx.reply(`📝 *Set Menu Message*\n\nAvailable variables:\n{first_name} - User's first name\n{last_name} - User's last name\n{full_name} - Full name\n{username} - Username with @\n{name} - Short name\n\nCurrent message:\n${(await db.collection('admin').findOne({type:'config'})).menuMessage}\n\nSend new message:`, {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_menu_message_scene');
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

// 5. Set Code Timer
bot.action('admin_set_timer', async (ctx) => {
    await ctx.reply("⏰ *Set Code Generation Timer*\n\nEnter time in hours (e.g., 2 for 2 hours):", {
        parse_mode: 'Markdown'
    });
    await ctx.scene.enter('set_timer_scene');
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

// 6. Manage Channels
bot.action('admin_channels', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config?.channels || [];
    
    let text = "📺 *Manage Channels*\n\n";
    let keyboard = [];
    
    channels.forEach(ch => {
        keyboard.push([{ text: `✏️ ${ch.buttonLabel}`, callback_data: `manage_chan_${ch.id}` }]);
    });
    
    keyboard.push([{ text: '➕ Add Channel', callback_data: 'add_channel' }]);
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

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

scenes.add_chan_scene.on('text', async (ctx) => {
    ctx.scene.state.buttonLabel = ctx.message.text;
    
    if (ctx.scene.state.type === 'public') {
        await ctx.reply("Now send the **Channel ID** (-100...), **Username** (@name), or **Forward a message** from the channel:");
    } else {
        await ctx.reply("Now send the **Channel ID** (-100...) or **Forward a message** from the channel:");
    }
});

scenes.add_chan_scene.on('message', async (ctx) => {
    if (ctx.message.text?.toLowerCase() === 'cancel') {
        await ctx.reply("Cancelled");
        return ctx.scene.leave();
    }
    
    const { type, buttonLabel } = ctx.scene.state;
    let chatId;
    
    if (ctx.message.forward_from_chat) {
        chatId = ctx.message.forward_from_chat.id;
    } else if (ctx.message.text) {
        chatId = ctx.message.text.trim().replace('@', '');
    } else {
        await ctx.reply("❌ Invalid input.");
        return ctx.scene.leave();
    }
    
    try {
        const chat = await ctx.telegram.getChat(chatId);
        
        const channelData = {
            id: chat.id,
            title: chat.title,
            buttonLabel: buttonLabel,
            type: type
        };
        
        if (type === 'public') {
            channelData.link = chat.username ? `https://t.me/${chat.username}` : await ctx.telegram.exportChatInviteLink(chat.id);
        } else {
            await ctx.reply("Now send the **Private Invite Link**:");
            ctx.scene.state.chatData = channelData;
            return;
        }
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { channels: channelData } }
        );
        await ctx.reply("✅ Channel added!");
        
    } catch (e) {
        await ctx.reply(`❌ Error: ${e.message}`);
    }
    
    await ctx.scene.leave();
});

scenes.add_chan_scene.on('text', async (ctx) => {
    if (ctx.scene.state.chatData && ctx.scene.state.chatData.type === 'private') {
        const privateLink = ctx.message.text.trim();
        const channelData = ctx.scene.state.chatData;
        channelData.link = privateLink;
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { channels: channelData } }
        );
        await ctx.reply("✅ Private channel added!");
        await ctx.scene.leave();
    }
});

// 7. Manage Apps
bot.action('admin_apps', async (ctx) => {
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    let text = "📱 *Manage Apps*\n\n";
    let keyboard = [];
    
    apps.forEach(app => {
        keyboard.push([{ text: `✏️ ${app.name}`, callback_data: `manage_app_${app.id}` }]);
    });
    
    keyboard.push([{ text: '➕ Add App', callback_data: 'add_app' }]);
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    
    await ctx.editMessageText(text, { 
        parse_mode: 'Markdown', 
        reply_markup: { inline_keyboard: keyboard } 
    });
});

bot.action('add_app', async (ctx) => {
    await ctx.reply("Enter app name:");
    await ctx.scene.enter('add_app_scene');
});

scenes.add_app_scene.on('text', async (ctx) => {
    if (!ctx.scene.state.step) {
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
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { 
                apps: {
                    id: id,
                    name: ctx.scene.state.name,
                    image: ctx.scene.state.image || '',
                    codeCount: ctx.scene.state.codeCount,
                    codePrefixes: ctx.scene.state.codePrefixes,
                    codeLengths: ctx.scene.state.codeLengths,
                    codeMessage: ctx.message.text
                }
            } }
        );
        
        await ctx.reply("✅ App added successfully!");
        await ctx.scene.leave();
    }
});

// Broadcast
bot.action('admin_broadcast', async (ctx) => {
    await ctx.reply("📢 Send message to broadcast:");
    await ctx.scene.enter('broadcast_scene');
});

scenes.broadcast_scene.on('message', async (ctx) => {
    const users = await db.collection('info').find({}).toArray();
    await ctx.reply(`Broadcasting to ${users.length} users...`);
    
    for (const user of users) {
        try {
            await ctx.telegram.copyMessage(user.user, ctx.chat.id, ctx.message.message_id);
            await new Promise(resolve => setTimeout(resolve, 50));
        } catch (e) {}
    }
    
    await ctx.reply("✅ Broadcast completed!");
    await ctx.scene.leave();
});

// User Stats
bot.action('admin_userdata', async (ctx) => {
    const users = await db.collection('info').find({}).toArray();
    let text = `👥 *User Statistics*\n\n📊 Total Users: ${users.length}\n\n`;
    
    users.slice(0, 20).forEach((user, i) => {
        text += `${i+1}. ${user.username ? `@${user.username}` : user.first_name} - ${user.joinedAll ? '✅' : '❌'}\n`;
    });
    
    await ctx.replyWithMarkdown(text);
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
