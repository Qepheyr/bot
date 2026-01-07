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
        return true;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        return false;
    }
}

// Scene setup
const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

// 🔐 ADMIN CONFIGURATION
const ADMIN_IDS = [8435248854, 7823816525];

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Check Admin Status
async function isAdmin(userId) {
    try {
        const userIdNum = Number(userId);
        if (ADMIN_IDS.includes(userIdNum)) return true;
        
        const config = await db.collection('admin').findOne({ type: 'config' });
        return config?.admins?.some(id => String(id) === String(userId)) || false;
    } catch (e) {
        console.error("Admin check error:", e);
        return false;
    }
}

// Notify Admins
async function notifyAdmin(text) {
    for (const adminId of ADMIN_IDS) {
        try {
            await bot.telegram.sendMessage(adminId, text);
        } catch (e) {}
    }
}

// Smart Name Logic
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

// Get Unjoined Channels
async function getUnjoinedChannels(userId) {
    const config = await db.collection('admin').findOne({ type: 'config' });
    if (!config?.channels?.length) return [];
    
    let unjoined = [];
    for (const ch of config.channels) {
        try {
            const member = await bot.telegram.getChatMember(ch.id, userId);
            if (['left', 'kicked', 'restricted'].includes(member.status)) {
                unjoined.push(ch);
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
        await ctx.reply("❌ Error starting bot. Please try again.");
    }
});

async function showStartScreen(ctx) {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const channels = config?.channels || [];
        
        if (channels.length === 0) {
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
        
        if (startImage && startImage.includes('http')) {
            try {
                await ctx.replyWithPhoto(imageUrl, {
                    caption: formatVariables(startMessage, ctx.from),
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: channelButtons,
                        resize_keyboard: true
                    }
                });
                return;
            } catch (e) {
                console.log("Failed to send photo, sending text instead");
            }
        }
        
        await ctx.reply(formatVariables(startMessage, ctx.from), {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: channelButtons,
                resize_keyboard: true
            }
        });
    } catch (e) {
        console.error("Error showing start screen:", e);
        await ctx.reply("Welcome! Please try again.");
    }
}

// Handle channel join buttons
bot.hears(/^Join (.+)$/, async (ctx) => {
    const buttonName = ctx.match[1];
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channel = config?.channels?.find(c => c.buttonLabel === buttonName);
    
    if (channel) {
        await ctx.reply(`📢 Click to join: ${channel.link}`);
    } else {
        await ctx.reply('❌ Channel not found');
    }
});

// Verify all channels button
bot.hears('✅ Verify All Channels', async (ctx) => {
    try {
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
    } catch (e) {
        console.error("Verify error:", e);
        await ctx.reply("❌ Error verifying. Please try again.");
    }
});

async function showMenu(ctx) {
    try {
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
        
        if (menuImage && menuImage.includes('http')) {
            try {
                await ctx.replyWithPhoto(imageUrl, {
                    caption: formatVariables(menuMessage, ctx.from),
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: keyboard,
                        resize_keyboard: true
                    }
                });
                return;
            } catch (e) {
                console.log("Failed to send menu photo");
            }
        }
        
        await ctx.reply(formatVariables(menuMessage, ctx.from), {
            parse_mode: 'Markdown',
            reply_markup: {
                keyboard: keyboard,
                resize_keyboard: true
            }
        });
    } catch (e) {
        console.error("Error showing menu:", e);
        await ctx.reply("Select an app:");
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
    try {
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
        
        if (app.image && app.image.includes('http')) {
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
    } catch (e) {
        console.error("App selection error:", e);
        await ctx.reply("❌ Error generating codes. Please try again.");
    }
}

// ==========================================
// BASIC COMMANDS
// ==========================================

bot.command('help', async (ctx) => {
    await ctx.reply(
        "🤖 *Bot Commands*\n\n" +
        "`/start` - Start the bot\n" +
        "`/adminpanel` - Admin panel\n" +
        "`/debug` - Debug info\n" +
        "`/test` - Test command\n" +
        "`/ping` - Check if bot is alive\n\n" +
        "👑 *Admin Only*\n" +
        "`/stats` - User statistics\n" +
        "`/broadcast` - Broadcast message",
        { parse_mode: 'Markdown' }
    );
});

bot.command('test', async (ctx) => {
    await ctx.reply(`✅ Bot is working! Your ID: ${ctx.from.id}`);
});

bot.command('ping', async (ctx) => {
    await ctx.reply('🏓 Pong!');
});

// ==========================================
// DEBUG COMMAND
// ==========================================

bot.command('debug', async (ctx) => {
    const userId = ctx.from.id;
    const isAdminUser = await isAdmin(userId);
    
    let dbInfo = "❌ Could not connect to DB";
    let userCount = 0;
    let appCount = 0;
    let channelCount = 0;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        dbInfo = config ? "✅ DB Connected" : "❌ No config found";
        
        if (config) {
            appCount = config.apps?.length || 0;
            channelCount = config.channels?.length || 0;
        }
        
        const users = await db.collection('info').find({}).toArray();
        userCount = users.length;
    } catch (e) {
        dbInfo = `❌ DB Error: ${e.message}`;
    }
    
    await ctx.reply(
        `🔍 *Debug Information*\n\n` +
        `👤 Your ID: \`${userId}\`\n` +
        `👤 Username: @${ctx.from.username || 'none'}\n` +
        `👑 Is Admin: ${isAdminUser ? '✅ YES' : '❌ NO'}\n` +
        `📋 Hardcoded Admins: ${ADMIN_IDS.join(', ')}\n` +
        `🗃️ Database: ${dbInfo}\n` +
        `👥 Users: ${userCount}\n` +
        `📱 Apps: ${appCount}\n` +
        `📺 Channels: ${channelCount}`,
        { parse_mode: 'Markdown' }
    );
});

// ==========================================
// 🛡️ ADMIN PANEL
// ==========================================

bot.command('adminpanel', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    
    if (!isAdminUser) {
        await ctx.reply("❌ You are not authorized to access admin panel.");
        return;
    }
    
    await sendAdminPanel(ctx);
});

// Handle "admin" as text
bot.hears('admin', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    
    if (!isAdminUser) {
        await ctx.reply("❌ You are not authorized.");
        return;
    }
    
    await sendAdminPanel(ctx);
});

// Function to send admin panel
async function sendAdminPanel(ctx) {
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
        [{ text: '📱 Manage Apps', callback_data: 'admin_apps' }],
        [{ text: '🗑️ Delete Data', callback_data: 'admin_delete_data' }],
        [{ text: '🔙 Back to User', callback_data: 'user_back' }]
    ];
    
    if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { 
            parse_mode: 'Markdown', 
            reply_markup: { inline_keyboard: keyboard } 
        });
    } else {
        await ctx.replyWithMarkdown(text, { 
            reply_markup: { inline_keyboard: keyboard } 
        });
    }
}

// Back button handler
bot.action('admin_back', async (ctx) => {
    await sendAdminPanel(ctx);
});

bot.action('user_back', async (ctx) => {
    await ctx.deleteMessage();
    await showStartScreen(ctx);
});

// ==========================================
// ADMIN FUNCTIONS
// ==========================================

// 1. Broadcast
bot.action('admin_broadcast', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    await ctx.reply("📢 *Broadcast Message*\n\nSend the message you want to broadcast to all users:", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_back' }]] }
    });
    
    // Simple broadcast handler
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id) {
            try {
                const users = await db.collection('info').find({}).toArray();
                let sent = 0;
                let failed = 0;
                
                await msgCtx.reply(`📤 Broadcasting to ${users.length} users...`);
                
                for (const user of users) {
                    try {
                        await bot.telegram.copyMessage(user.user, msgCtx.chat.id, msgCtx.message.message_id);
                        sent++;
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } catch (e) {
                        failed++;
                    }
                }
                
                await msgCtx.reply(`✅ Broadcast completed!\n\nSent: ${sent}\nFailed: ${failed}`);
            } catch (e) {
                await msgCtx.reply("❌ Error during broadcast");
            }
        }
    });
});

// 2. User Stats
bot.action('admin_userdata', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    try {
        const users = await db.collection('info').find({}).toArray();
        const total = users.length;
        const joined = users.filter(u => u.joinedAll).length;
        const today = new Date();
        const activeToday = users.filter(u => {
            if (!u.lastActive) return false;
            const lastActive = new Date(u.lastActive);
            return lastActive.toDateString() === today.toDateString();
        }).length;
        
        let text = `👥 *User Statistics*\n\n`;
        text += `📊 Total Users: ${total}\n`;
        text += `✅ Verified Users: ${joined}\n`;
        text += `📈 Active Today: ${activeToday}\n\n`;
        
        if (users.length > 0) {
            text += `*Recent Users (5):*\n`;
            users.slice(-5).reverse().forEach((user, i) => {
                const name = user.username ? `@${user.username}` : user.first_name || `ID:${user.user}`;
                text += `${i+1}. ${name} - ${user.joinedAll ? '✅' : '❌'}\n`;
            });
        }
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]] }
        });
    } catch (e) {
        await ctx.editMessageText("❌ Error fetching user data", {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_back' }]] }
        });
    }
});

// 3. Start Image
bot.action('admin_start_image', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentImage = config?.startImage || 'Not set';
    
    const text = `🖼️ *Start Image*\n\nCurrent: ${currentImage}\n\nOptions:`;
    const keyboard = [
        [{ text: '📤 Set New Image', callback_data: 'set_start_image' }],
        [{ text: '🗑️ Remove Image', callback_data: 'remove_start_image' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.action('set_start_image', async (ctx) => {
    await ctx.editMessageText("📤 Send image URL or photo:\n\nUse {name} for username variable\nType 'cancel' to cancel", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_start_image' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id) {
            if (msgCtx.text?.toLowerCase() === 'cancel') {
                await msgCtx.reply("Cancelled");
                return;
            }
            
            let imageUrl;
            if (msgCtx.photo) {
                const photo = msgCtx.photo[msgCtx.photo.length - 1];
                const file = await bot.telegram.getFile(photo.file_id);
                imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            } else if (msgCtx.text) {
                imageUrl = msgCtx.text.trim();
            }
            
            if (imageUrl) {
                await db.collection('admin').updateOne(
                    { type: 'config' },
                    { $set: { startImage: imageUrl } }
                );
                await msgCtx.reply("✅ Start image updated!");
            } else {
                await msgCtx.reply("❌ Invalid image");
            }
        }
    });
});

bot.action('remove_start_image', async (ctx) => {
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { startImage: '' } }
    );
    await ctx.answerCbQuery('✅ Image removed');
    await ctx.editMessageText("✅ Start image removed!", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_start_image' }]] }
    });
});

// 4. Start Message
bot.action('admin_start_message', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentMessage = config?.startMessage || 'Not set';
    
    const text = `📝 *Start Message*\n\nCurrent:\n${currentMessage}\n\nVariables: {first_name}, {last_name}, {full_name}, {username}, {name}\n\nOptions:`;
    const keyboard = [
        [{ text: '✏️ Edit Message', callback_data: 'edit_start_message' }],
        [{ text: '🔄 Reset Default', callback_data: 'reset_start_message' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.action('edit_start_message', async (ctx) => {
    await ctx.editMessageText("✏️ Send new start message:\n\nVariables: {first_name}, {last_name}, {full_name}, {username}, {name}\nType 'cancel' to cancel", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_start_message' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id && msgCtx.text) {
            if (msgCtx.text.toLowerCase() === 'cancel') {
                await msgCtx.reply("Cancelled");
                return;
            }
            
            await db.collection('admin').updateOne(
                { type: 'config' },
                { $set: { startMessage: msgCtx.text } }
            );
            await msgCtx.reply("✅ Start message updated!");
        }
    });
});

bot.action('reset_start_message', async (ctx) => {
    const defaultMessage = '👋 *Welcome! We are Premium Agents.*\n\n⚠️ _Access Denied_\nTo access our exclusive agent list, you must join our affiliate channels below:';
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { startMessage: defaultMessage } }
    );
    await ctx.answerCbQuery('✅ Reset to default');
    await ctx.editMessageText("✅ Start message reset to default!", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_start_message' }]] }
    });
});

// 5. Menu Image (similar to start image)
bot.action('admin_menu_image', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentImage = config?.menuImage || 'Not set';
    
    const text = `🖼️ *Menu Image*\n\nCurrent: ${currentImage}\n\nOptions:`;
    const keyboard = [
        [{ text: '📤 Set New Image', callback_data: 'set_menu_image' }],
        [{ text: '🗑️ Remove Image', callback_data: 'remove_menu_image' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.action('set_menu_image', async (ctx) => {
    await ctx.editMessageText("📤 Send menu image URL or photo:\n\nUse {name} for username variable\nType 'cancel' to cancel", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_menu_image' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id) {
            if (msgCtx.text?.toLowerCase() === 'cancel') {
                await msgCtx.reply("Cancelled");
                return;
            }
            
            let imageUrl;
            if (msgCtx.photo) {
                const photo = msgCtx.photo[msgCtx.photo.length - 1];
                const file = await bot.telegram.getFile(photo.file_id);
                imageUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
            } else if (msgCtx.text) {
                imageUrl = msgCtx.text.trim();
            }
            
            if (imageUrl) {
                await db.collection('admin').updateOne(
                    { type: 'config' },
                    { $set: { menuImage: imageUrl } }
                );
                await msgCtx.reply("✅ Menu image updated!");
            } else {
                await msgCtx.reply("❌ Invalid image");
            }
        }
    });
});

bot.action('remove_menu_image', async (ctx) => {
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { menuImage: '' } }
    );
    await ctx.answerCbQuery('✅ Image removed');
    await ctx.editMessageText("✅ Menu image removed!", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_menu_image' }]] }
    });
});

// 6. Menu Message
bot.action('admin_menu_message', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentMessage = config?.menuMessage || 'Not set';
    
    const text = `📝 *Menu Message*\n\nCurrent:\n${currentMessage}\n\nVariables: {first_name}, {last_name}, {full_name}, {username}, {name}\n\nOptions:`;
    const keyboard = [
        [{ text: '✏️ Edit Message', callback_data: 'edit_menu_message' }],
        [{ text: '🔄 Reset Default', callback_data: 'reset_menu_message' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.action('edit_menu_message', async (ctx) => {
    await ctx.editMessageText("✏️ Send new menu message:\n\nVariables: {first_name}, {last_name}, {full_name}, {username}, {name}\nType 'cancel' to cancel", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_menu_message' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id && msgCtx.text) {
            if (msgCtx.text.toLowerCase() === 'cancel') {
                await msgCtx.reply("Cancelled");
                return;
            }
            
            await db.collection('admin').updateOne(
                { type: 'config' },
                { $set: { menuMessage: msgCtx.text } }
            );
            await msgCtx.reply("✅ Menu message updated!");
        }
    });
});

bot.action('reset_menu_message', async (ctx) => {
    const defaultMessage = '🎉 *Welcome to the Agent Panel!*\n\n✅ _Verification Successful_\nSelect an app below to generate codes:';
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { menuMessage: defaultMessage } }
    );
    await ctx.answerCbQuery('✅ Reset to default');
    await ctx.editMessageText("✅ Menu message reset to default!", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_menu_message' }]] }
    });
});

// 7. Code Timer
bot.action('admin_timer', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const currentTimer = config?.codeTimer || 7200;
    const hours = (currentTimer / 3600).toFixed(1);
    
    const text = `⏰ *Code Timer*\n\nCurrent: ${hours} hours\n\nOptions:`;
    const keyboard = [
        [{ text: '✏️ Set Timer (hours)', callback_data: 'set_timer' }],
        [{ text: '🔄 Reset to 2h', callback_data: 'reset_timer' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.action('set_timer', async (ctx) => {
    await ctx.editMessageText("⏰ Enter timer in hours (e.g., 2 for 2 hours):\n\nType 'cancel' to cancel", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_timer' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id && msgCtx.text) {
            if (msgCtx.text.toLowerCase() === 'cancel') {
                await msgCtx.reply("Cancelled");
                return;
            }
            
            const hours = parseFloat(msgCtx.text);
            if (isNaN(hours) || hours <= 0) {
                await msgCtx.reply("❌ Please enter a valid number of hours");
                return;
            }
            
            const seconds = Math.floor(hours * 3600);
            await db.collection('admin').updateOne(
                { type: 'config' },
                { $set: { codeTimer: seconds } }
            );
            await msgCtx.reply(`✅ Timer set to ${hours} hours`);
        }
    });
});

bot.action('reset_timer', async (ctx) => {
    await db.collection('admin').updateOne(
        { type: 'config' },
        { $set: { codeTimer: 7200 } }
    );
    await ctx.answerCbQuery('✅ Reset to 2 hours');
    await ctx.editMessageText("✅ Timer reset to 2 hours!", {
        reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_timer' }]] }
    });
});

// 8. Manage Channels
bot.action('admin_channels', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const channels = config?.channels || [];
    
    let text = `📺 *Manage Channels*\n\n`;
    if (channels.length === 0) {
        text += "No channels added yet.\n\n";
    } else {
        text += `Total: ${channels.length}\n\n`;
        channels.forEach((ch, i) => {
            text += `${i+1}. ${ch.buttonLabel} (${ch.type})\n`;
        });
        text += "\n";
    }
    
    text += "Options:";
    const keyboard = [
        [{ text: '➕ Add Channel', callback_data: 'add_channel' }]
    ];
    
    if (channels.length > 0) {
        keyboard.push([{ text: '🗑️ Delete Channel', callback_data: 'delete_channel' }]);
    }
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

// 9. Manage Apps
bot.action('admin_apps', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const config = await db.collection('admin').findOne({ type: 'config' });
    const apps = config?.apps || [];
    
    let text = `📱 *Manage Apps*\n\n`;
    if (apps.length === 0) {
        text += "No apps added yet.\n\n";
    } else {
        text += `Total: ${apps.length}\n\n`;
        apps.forEach((app, i) => {
            text += `${i+1}. ${app.name} (${app.codeCount} codes)\n`;
        });
        text += "\n";
    }
    
    text += "Options:";
    const keyboard = [
        [{ text: '➕ Add App', callback_data: 'add_app' }]
    ];
    
    if (apps.length > 0) {
        keyboard.push([{ text: '🗑️ Delete App', callback_data: 'delete_app' }]);
    }
    
    keyboard.push([{ text: '🔙 Back', callback_data: 'admin_back' }]);
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

// 10. Delete Data
bot.action('admin_delete_data', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    if (!isAdminUser) {
        await ctx.answerCbQuery('❌ Not authorized');
        return;
    }
    
    await ctx.answerCbQuery();
    
    const text = `🗑️ *Delete Data*\n\n⚠️ WARNING: These actions cannot be undone!\n\nSelect what to delete:`;
    const keyboard = [
        [{ text: '👥 Delete All Users', callback_data: 'delete_all_users' }],
        [{ text: '📺 Delete All Channels', callback_data: 'delete_all_channels' }],
        [{ text: '📱 Delete All Apps', callback_data: 'delete_all_apps' }],
        [{ text: '🔥 Delete EVERYTHING', callback_data: 'delete_everything' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

bot.action('delete_all_users', async (ctx) => {
    await ctx.editMessageText("🗑️ *Delete All Users*\n\nAre you sure? This will delete ALL user data.\n\nType 'CONFIRM' to proceed or 'CANCEL' to abort.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_delete_data' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id && msgCtx.text) {
            if (msgCtx.text.toUpperCase() === 'CONFIRM') {
                try {
                    const result = await db.collection('info').deleteMany({});
                    await msgCtx.reply(`✅ Deleted ${result.deletedCount} users!`);
                } catch (e) {
                    await msgCtx.reply("❌ Error deleting users");
                }
            } else {
                await msgCtx.reply("❌ Cancelled");
            }
        }
    });
});

bot.action('delete_all_channels', async (ctx) => {
    try {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { channels: [] } }
        );
        await ctx.answerCbQuery('✅ All channels deleted');
        await ctx.editMessageText("✅ All channels deleted!", {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_data' }]] }
        });
    } catch (e) {
        await ctx.editMessageText("❌ Error deleting channels", {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_data' }]] }
        });
    }
});

bot.action('delete_all_apps', async (ctx) => {
    try {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { apps: [] } }
        );
        await ctx.answerCbQuery('✅ All apps deleted');
        await ctx.editMessageText("✅ All apps deleted!", {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_data' }]] }
        });
    } catch (e) {
        await ctx.editMessageText("❌ Error deleting apps", {
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_delete_data' }]] }
        });
    }
});

bot.action('delete_everything', async (ctx) => {
    await ctx.editMessageText("🔥 *DELETE EVERYTHING*\n\n⚠️ This will delete ALL data: users, channels, apps, everything!\n\nType 'DELETE ALL' to proceed or 'CANCEL' to abort.", {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Cancel', callback_data: 'admin_delete_data' }]] }
    });
    
    bot.once('message', async (msgCtx) => {
        if (msgCtx.from.id === ctx.from.id && msgCtx.text) {
            if (msgCtx.text.toUpperCase() === 'DELETE ALL') {
                try {
                    // Delete users
                    const userResult = await db.collection('info').deleteMany({});
                    
                    // Reset config
                    await db.collection('admin').updateOne(
                        { type: 'config' },
                        { 
                            $set: { 
                                type: 'config',
                                admins: ADMIN_IDS,
                                channels: [],
                                apps: [],
                                startImage: 'https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:{name},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg',
                                startMessage: '👋 *Welcome! We are Premium Agents.*\n\n⚠️ _Access Denied_\nTo access our exclusive agent list, you must join our affiliate channels below:',
                                menuImage: 'https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:{name},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg',
                                menuMessage: '🎉 *Welcome to the Agent Panel!*\n\n✅ _Verification Successful_\nSelect an app below to generate codes:',
                                codeTimer: 7200
                            }
                        },
                        { upsert: true }
                    );
                    
                    await msgCtx.reply(`🔥 COMPLETE WIPE COMPLETED!\n\n✅ Deleted ${userResult.deletedCount} users\n✅ Reset all settings\n✅ Bot is now fresh!`);
                } catch (e) {
                    await msgCtx.reply("❌ Error during wipe");
                }
            } else {
                await msgCtx.reply("❌ Cancelled");
            }
        }
    });
});

// ==========================================
// ADMIN STATS COMMAND
// ==========================================

bot.command('stats', async (ctx) => {
    const isAdminUser = await isAdmin(ctx.from.id);
    
    if (!isAdminUser) {
        await ctx.reply("❌ Admin only command.");
        return;
    }
    
    try {
        const users = await db.collection('info').find({}).toArray();
        const config = await db.collection('admin').findOne({ type: 'config' });
        
        const totalUsers = users.length;
        const verifiedUsers = users.filter(u => u.joinedAll).length;
        const totalChannels = config?.channels?.length || 0;
        const totalApps = config?.apps?.length || 0;
        
        await ctx.reply(
            `📊 *Bot Statistics*\n\n` +
            `👥 Total Users: ${totalUsers}\n` +
            `✅ Verified Users: ${verifiedUsers}\n` +
            `📺 Channels: ${totalChannels}\n` +
            `📱 Apps: ${totalApps}\n` +
            `👑 Admins: ${ADMIN_IDS.length}\n` +
            `🤖 Status: ✅ Running`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        await ctx.reply("❌ Error fetching stats");
    }
});

// ==========================================
// ERROR HANDLING
// ==========================================

bot.catch((err, ctx) => {
    console.error(`Error for ${ctx.updateType}:`, err);
    try {
        ctx.reply("❌ An error occurred. Please try again.");
    } catch (e) {}
});

// ==========================================
// INITIALIZE & START BOT
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
                    codeTimer: 7200
                }
            },
            { upsert: true }
        );
        console.log(`✅ Bot initialized with ${ADMIN_IDS.length} admins`);
    } catch (e) {
        console.error("❌ Error initializing bot:", e);
    }
}

async function startBot() {
    console.log("🚀 Starting bot...");
    
    try {
        // Connect to MongoDB
        const dbConnected = await connectDB();
        if (!dbConnected) {
            console.log("⚠️ Starting without MongoDB connection");
        } else {
            // Initialize database
            await initBot();
        }
        
        // Start bot
        await bot.launch();
        console.log('🤖 Bot is running...');
        
        // Graceful shutdown
        process.once('SIGINT', () => {
            console.log('🛑 Stopping bot...');
            bot.stop('SIGINT');
        });
        process.once('SIGTERM', () => {
            console.log('🛑 Stopping bot...');
            bot.stop('SIGTERM');
        });
        
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
        console.log(`🌐 Web server running on port ${PORT}`);
        startBot();
    });
} else {
    startBot();
}

console.log("📦 Bot package loaded successfully!");
