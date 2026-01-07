// ==========================================
// TELEGRAM BOT - COMPLETE FIXED SOLUTION
// ==========================================
// Fixed: Database issues, channel/app management, contact user feature
// ==========================================

const { Telegraf, Scenes, session, Markup } = require('telegraf');
const { MongoClient, ObjectId } = require('mongodb');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const fetch = require('node-fetch');
require('dotenv').config();

// Cloudinary configuration
cloudinary.config({
  cloud_name: 'dneusgyzc',
  api_key: '474713292161728',
  api_secret: 'DHJmvD784FEVmeOt1-K8XeNhCQQ'
});

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN || '8157925136:AAFPNIG6ipDPyAnwqc9cgIvBa2pcqVDfrW8';
const bot = new Telegraf(BOT_TOKEN);

// MongoDB connection
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://sandip102938:Q1g2Fbn7ewNqEvuK@test.ebvv4hf.mongodb.net/telegram_bot';
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

// Initialize scenes and session
const stage = new Scenes.Stage([]);
bot.use(session());
bot.use(stage.middleware());

// Scene handler factory
function createScene(sceneId) {
    return new Scenes.BaseScene(sceneId);
}

// SCENE DEFINITIONS
const scenes = {
    // Broadcast scene
    broadcast: createScene('broadcast_scene'),
    
    // Channel scenes
    addChannelName: createScene('add_channel_name_scene'),
    addChannelId: createScene('add_channel_id_scene'),
    
    // App scenes
    addAppName: createScene('add_app_name_scene'),
    addAppImage: createScene('add_app_image_scene'),
    addAppCodeCount: createScene('add_app_code_count_scene'),
    addAppCodePrefixes: createScene('add_app_code_prefixes_scene'),
    addAppCodeLengths: createScene('add_app_code_lengths_scene'),
    addAppCodeMessage: createScene('add_app_code_message_scene'),
    
    // Contact user scenes
    contactUser: createScene('contact_user_scene'),
    contactUserId: createScene('contact_user_id_scene'),
    contactUserMessage: createScene('contact_user_message_scene'),
    
    // Reply to user scene
    replyToUser: createScene('reply_to_user_scene'),
    
    // Image and message scenes
    editStartImage: createScene('edit_start_image_scene'),
    editStartMessage: createScene('edit_start_message_scene'),
    editMenuImage: createScene('edit_menu_image_scene'),
    editMenuMessage: createScene('edit_menu_message_scene'),
    
    // Timer scene
    editTimer: createScene('edit_timer_scene'),
    
    // Admin scenes
    addAdmin: createScene('add_admin_scene')
};

// Register all scenes
Object.values(scenes).forEach(scene => stage.register(scene));

// 🔐 ADMIN CONFIGURATION
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(Number) : [8435248854, 7478663641];

// Default configurations
const DEFAULT_CONFIG = {
    startImage: 'https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:{name},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg',
    startMessage: '👋 *Welcome! We are Premium Agents.*\n\n⚠️ _Access Denied_\nTo access our exclusive agent list, you must join our affiliate channels below:',
    menuImage: 'https://res.cloudinary.com/dneusgyzc/image/upload/l_text:Stalinist%20One_140_bold:{name},co_rgb:00e5ff,g_center/fl_preserve_transparency/v1763670359/1000106281_cfg1ke.jpg',
    menuMessage: '🎉 *Welcome to the Agent Panel!*\n\n✅ _Verification Successful_\nSelect an app below to generate codes:',
    codeTimer: 7200 // 2 hours in seconds
};

// ==========================================
// DATABASE INITIALIZATION
// ==========================================

async function initBot() {
    try {
        // Check if config exists
        const config = await db.collection('admin').findOne({ type: 'config' });
        
        if (!config) {
            // Create new config
            await db.collection('admin').insertOne({
                type: 'config',
                admins: ADMIN_IDS,
                startImage: DEFAULT_CONFIG.startImage,
                startMessage: DEFAULT_CONFIG.startMessage,
                menuImage: DEFAULT_CONFIG.menuImage,
                menuMessage: DEFAULT_CONFIG.menuMessage,
                codeTimer: DEFAULT_CONFIG.codeTimer,
                channels: [],
                apps: [],
                createdAt: new Date(),
                updatedAt: new Date()
            });
            console.log('✅ Created new bot configuration');
        } else {
            console.log('✅ Loaded existing bot configuration');
        }
        
        // Create indexes
        await db.collection('users').createIndex({ userId: 1 }, { unique: true });
        await db.collection('admin').createIndex({ type: 1 }, { unique: true });
        
        console.log(`✅ Bot initialized with ${ADMIN_IDS.length} admins`);
        return true;
    } catch (error) {
        console.error('❌ Error initializing bot:', error);
        return false;
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

// Notify ALL Admins
async function notifyAdmin(text) {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const allAdmins = config?.admins || ADMIN_IDS;
        
        for (const adminId of allAdmins) {
            try {
                await bot.telegram.sendMessage(adminId, text, { parse_mode: 'Markdown' });
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`Failed to notify admin ${adminId}:`, error.message);
            }
        }
    } catch (error) {
        console.error('Error in notifyAdmin:', error);
    }
}

// Smart Name Logic
function getSmartName(user) {
    try {
        let firstName = user.first_name || '';
        let username = user.username || '';
        let lastName = user.last_name || '';
        
        let finalName = 'Agent';
        
        if (firstName && firstName.length <= 8) {
            finalName = firstName;
        } else if (username) {
            finalName = username;
        } else if (lastName) {
            finalName = lastName;
        }
        
        if (finalName.length > 10) {
            finalName = finalName.substring(0, 9) + '...';
        }
        
        return finalName;
    } catch (error) {
        return 'Agent';
    }
}

// Check Admin Status
async function isAdmin(userId) {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        if (!config || !config.admins) return ADMIN_IDS.includes(Number(userId));
        
        return config.admins.some(id => String(id) === String(userId));
    } catch (error) {
        console.error('Error checking admin:', error);
        return ADMIN_IDS.includes(Number(userId));
    }
}

// Get Unjoined Channels
async function getUnjoinedChannels(userId) {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        if (!config || !config.channels || config.channels.length === 0) return [];
        
        const unjoined = [];
        
        for (const channel of config.channels) {
            try {
                const member = await bot.telegram.getChatMember(channel.id, userId);
                if (member.status === 'left' || member.status === 'kicked') {
                    unjoined.push(channel);
                }
            } catch (error) {
                console.error(`Error checking channel ${channel.id}:`, error.message);
                unjoined.push(channel);
            }
        }
        
        return unjoined;
    } catch (error) {
        console.error('Error in getUnjoinedChannels:', error);
        return [];
    }
}

// Generate Random Code
function generateCode(prefix = '', length = 8) {
    try {
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let code = prefix;
        
        for (let i = code.length; i < length; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }
        
        return code;
    } catch (error) {
        return 'ERROR123';
    }
}

// Format Time Remaining
function formatTimeRemaining(seconds) {
    try {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        return `${hours}h ${minutes}m ${secs}s`;
    } catch (error) {
        return 'Error';
    }
}

// Replace Variables in Text
function replaceVariables(text, variables) {
    try {
        let result = text;
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`\\{${key}\\}`, 'gi');
            result = result.replace(regex, value || '');
        }
        return result;
    } catch (error) {
        return text;
    }
}

// Get User Variables
function getUserVariables(user) {
    try {
        const smartName = getSmartName(user);
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
        
        return {
            first_name: user.first_name || '',
            last_name: user.last_name || '',
            full_name: fullName || '',
            username: user.username ? `@${user.username}` : '',
            name: smartName
        };
    } catch (error) {
        return {
            first_name: '',
            last_name: '',
            full_name: '',
            username: '',
            name: 'Agent'
        };
    }
}

// Upload to Cloudinary
async function uploadToCloudinary(fileBuffer, folder = 'bot_images') {
    try {
        return new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                { 
                    folder: folder,
                    resource_type: 'auto'
                },
                (error, result) => {
                    if (error) {
                        console.error('Cloudinary upload error:', error);
                        reject(error);
                    } else {
                        resolve(result);
                    }
                }
            );
            
            if (!fileBuffer || fileBuffer.length === 0) {
                reject(new Error('Empty file buffer'));
                return;
            }
            
            uploadStream.end(fileBuffer);
        });
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        throw error;
    }
}

// Get Cloudinary URL with name
function getCloudinaryUrlWithName(originalUrl, name) {
    try {
        if (!originalUrl.includes('cloudinary.com')) return originalUrl;
        
        // Add text overlay for name
        const encodedName = encodeURIComponent(name);
        return originalUrl.replace('/upload/', `/upload/l_text:Stalinist%20One_140_bold:${encodedName},co_rgb:00e5ff,g_center/`);
    } catch (error) {
        return originalUrl;
    }
}

// Save to Database Helper
async function saveToDatabase(collection, query, update, options = {}) {
    try {
        const result = await db.collection(collection).updateOne(
            query,
            update,
            { upsert: true, ...options }
        );
        return result;
    } catch (error) {
        console.error(`Database error in ${collection}:`, error);
        throw error;
    }
}

// ==========================================
// USER FLOW - START COMMAND
// ==========================================

bot.start(async (ctx) => {
    try {
        const user = ctx.from;
        const userId = user.id;
        
        // Save or update user
        await saveToDatabase('users', 
            { userId: userId },
            {
                $set: {
                    firstName: user.first_name,
                    lastName: user.last_name,
                    username: user.username,
                    lastActive: new Date()
                },
                $setOnInsert: {
                    joinedAll: false,
                    joinedAt: new Date(),
                    codeTimestamps: {}
                }
            }
        );
        
        // Check if new user
        const existingUser = await db.collection('users').findOne({ userId: userId });
        if (!existingUser.joinedAt) {
            const userLink = user.username ? `@${user.username}` : user.first_name || 'Unknown';
            await notifyAdmin(`🆕 *New User Joined*\nID: \`${userId}\`\nUser: ${userLink}`);
        }
        
        await showStartScreen(ctx);
    } catch (error) {
        console.error('Start command error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
});

// Show Start Screen
async function showStartScreen(ctx) {
    try {
        const user = ctx.from;
        const userId = user.id;
        
        // Get unjoined channels
        const unjoinedChannels = await getUnjoinedChannels(userId);
        
        // Get configuration
        const config = await db.collection('admin').findOne({ type: 'config' });
        
        // Prepare user variables
        const userVars = getUserVariables(user);
        
        // Prepare image URL with name
        let startImage = config?.startImage || DEFAULT_CONFIG.startImage;
        startImage = getCloudinaryUrlWithName(startImage, userVars.name);
        
        // Prepare message
        let startMessage = config?.startMessage || DEFAULT_CONFIG.startMessage;
        startMessage = replaceVariables(startMessage, userVars);
        
        // Check if user is admin
        const isUserAdmin = await isAdmin(userId);
        
        // If user hasn't joined all channels
        if (unjoinedChannels.length > 0) {
            await db.collection('users').updateOne(
                { userId: userId },
                { $set: { joinedAll: false } }
            );
            
            // Create channel buttons
            const buttons = unjoinedChannels.map(channel => {
                const buttonText = channel.buttonLabel || `Join ${channel.title}`;
                return [{ text: buttonText, url: channel.link }];
            });
            
            // Add verify button
            buttons.push([{ text: '✅ Check Joined', callback_data: 'check_joined' }]);
            
            // Add contact button for admin
            if (isUserAdmin) {
                buttons.push([{ text: '💬 Contact User', callback_data: 'admin_contact_user' }]);
            }
            
            await ctx.replyWithPhoto(startImage, {
                caption: startMessage,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });
            return;
        }
        
        // User has joined all channels
        const userData = await db.collection('users').findOne({ userId: userId });
        if (!userData.joinedAll) {
            await db.collection('users').updateOne(
                { userId: userId },
                { $set: { joinedAll: true } }
            );
            
            const userLink = user.username ? `@${user.username}` : user.first_name || 'Unknown';
            await notifyAdmin(`✅ *User Joined All Channels*\nID: \`${userId}\`\nUser: ${userLink}`);
        }
        
        // Show main menu
        await showMainMenu(ctx);
    } catch (error) {
        console.error('Show start screen error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
}

// Show Main Menu
async function showMainMenu(ctx) {
    try {
        const user = ctx.from;
        const userId = user.id;
        
        // Get configuration
        const config = await db.collection('admin').findOne({ type: 'config' });
        const apps = config?.apps || [];
        
        // Prepare user variables
        const userVars = getUserVariables(user);
        
        // Prepare image URL with name
        let menuImage = config?.menuImage || DEFAULT_CONFIG.menuImage;
        menuImage = getCloudinaryUrlWithName(menuImage, userVars.name);
        
        // Prepare message
        let menuMessage = config?.menuMessage || DEFAULT_CONFIG.menuMessage;
        menuMessage = replaceVariables(menuMessage, userVars);
        
        // Create app buttons
        const keyboard = [];
        
        if (apps.length === 0) {
            keyboard.push([{ text: 'Coming Soon...', callback_data: 'no_apps' }]);
        } else {
            // Group apps 2 per row
            for (let i = 0; i < apps.length; i += 2) {
                const row = [];
                row.push({ text: apps[i].name, callback_data: `app_${apps[i].id}` });
                
                if (i + 1 < apps.length) {
                    row.push({ text: apps[i + 1].name, callback_data: `app_${apps[i + 1].id}` });
                }
                
                keyboard.push(row);
            }
        }
        
        // Add contact button for admin
        const isUserAdmin = await isAdmin(userId);
        if (isUserAdmin) {
            keyboard.push([{ text: '💬 Contact User', callback_data: 'admin_contact_user' }]);
        }
        
        // Add back button
        keyboard.push([{ text: '🔙 Back', callback_data: 'back_to_start' }]);
        
        await ctx.replyWithPhoto(menuImage, {
            caption: menuMessage,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Show main menu error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
}

// Check Joined Channels
bot.action('check_joined', async (ctx) => {
    try {
        await ctx.deleteMessage().catch(() => {});
        await showStartScreen(ctx);
    } catch (error) {
        console.error('Check joined error:', error);
    }
});

// Back to Start
bot.action('back_to_start', async (ctx) => {
    try {
        await ctx.deleteMessage().catch(() => {});
        await showStartScreen(ctx);
    } catch (error) {
        console.error('Back to start error:', error);
    }
});

// No Apps Available
bot.action('no_apps', async (ctx) => {
    await ctx.answerCbQuery('No apps available yet. Please check back later.');
});

// ==========================================
// APP CODE GENERATION
// ==========================================

bot.action(/^app_(.+)$/, async (ctx) => {
    try {
        await ctx.deleteMessage().catch(() => {});
        
        const appId = ctx.match[1];
        const userId = ctx.from.id;
        
        // Get app details
        const config = await db.collection('admin').findOne({ type: 'config' });
        const app = config?.apps?.find(a => a.id === appId);
        
        if (!app) {
            await ctx.reply('❌ App not found.');
            await showMainMenu(ctx);
            return;
        }
        
        // Get user data
        const userData = await db.collection('users').findOne({ userId: userId });
        const codeTimer = config?.codeTimer || DEFAULT_CONFIG.codeTimer;
        
        // Check cooldown
        const lastGenerated = userData?.codeTimestamps?.[appId];
        const now = Math.floor(Date.now() / 1000);
        
        if (lastGenerated && (now - lastGenerated) < codeTimer) {
            const remaining = codeTimer - (now - lastGenerated);
            const timeStr = formatTimeRemaining(remaining);
            
            await ctx.reply(
                `⏰ *Please Wait*\n\nYou can generate new codes for *${app.name}* in:\n\`${timeStr}\``,
                { parse_mode: 'Markdown' }
            );
            
            await ctx.reply('🔙 Back to Menu', {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'back_to_menu' }
                    ]]
                }
            });
            return;
        }
        
        // Generate codes
        const codes = [];
        const codeCount = app.codeCount || 1;
        const codePrefixes = app.codePrefixes || [];
        const codeLengths = app.codeLengths || [];
        
        for (let i = 0; i < codeCount; i++) {
            const prefix = codePrefixes[i] || '';
            const length = codeLengths[i] || 8;
            codes.push(generateCode(prefix, length));
        }
        
        // Prepare variables
        const userVars = getUserVariables(ctx.from);
        const appVars = {
            app_name: app.name,
            button_name: app.name
        };
        
        // Add code variables
        codes.forEach((code, index) => {
            appVars[`code${index + 1}`] = code;
        });
        
        // Replace variables in message
        let message = app.codeMessage || 'Your codes: {code1}';
        message = replaceVariables(message, userVars);
        message = replaceVariables(message, appVars);
        
        // Send app image if available
        if (app.image && app.image !== 'none') {
            await ctx.replyWithPhoto(app.image, {
                caption: message,
                parse_mode: 'Markdown'
            });
        } else {
            await ctx.reply(message, { parse_mode: 'Markdown' });
        }
        
        // Update user's cooldown
        await db.collection('users').updateOne(
            { userId: userId },
            { $set: { [`codeTimestamps.${appId}`]: now } }
        );
        
        // Show back button
        await ctx.reply('🔙 Back to Menu', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔙 Back', callback_data: 'back_to_menu' }
                ]]
            }
        });
        
    } catch (error) {
        console.error('App selection error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
        await showMainMenu(ctx);
    }
});

// Back to Menu
bot.action('back_to_menu', async (ctx) => {
    try {
        await ctx.deleteMessage().catch(() => {});
        await showMainMenu(ctx);
    } catch (error) {
        console.error('Back to menu error:', error);
    }
});

// ==========================================
// 🛡️ ADMIN PANEL
// ==========================================

bot.command('admin', async (ctx) => {
    try {
        if (!await isAdmin(ctx.from.id)) {
            return ctx.reply('❌ You are not authorized to use this command.');
        }
        
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Admin command error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
});

async function showAdminPanel(ctx) {
    try {
        const text = '👮‍♂️ *Admin Control Panel*\n\nSelect an option below:';
        const keyboard = [
            [{ text: '📢 Broadcast', callback_data: 'admin_broadcast' }, { text: '👥 User Stats', callback_data: 'admin_userstats' }],
            [{ text: '🖼️ Start Image', callback_data: 'admin_startimage' }, { text: '📝 Start Message', callback_data: 'admin_startmessage' }],
            [{ text: '🖼️ Menu Image', callback_data: 'admin_menuimage' }, { text: '📝 Menu Message', callback_data: 'admin_menumessage' }],
            [{ text: '⏰ Code Timer', callback_data: 'admin_timer' }, { text: '📺 Manage Channels', callback_data: 'admin_channels' }],
            [{ text: '📱 Manage Apps', callback_data: 'admin_apps' }, { text: '👑 Manage Admins', callback_data: 'admin_manage_admins' }],
            [{ text: '💬 Contact User', callback_data: 'admin_contact_user' }, { text: '🗑️ Delete Data', callback_data: 'admin_deletedata' }],
            [{ text: '🔄 Refresh', callback_data: 'admin_refresh' }]
        ];
        
        if (ctx.callbackQuery) {
            await ctx.editMessageText(text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await ctx.reply(text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }
    } catch (error) {
        console.error('Show admin panel error:', error);
        await ctx.reply('❌ An error occurred. Please try again.');
    }
}

// Admin refresh
bot.action('admin_refresh', async (ctx) => {
    await showAdminPanel(ctx);
});

// Back to Admin Panel
bot.action('admin_back', async (ctx) => {
    await showAdminPanel(ctx);
});

// ==========================================
// ADMIN FEATURES - BROADCAST
// ==========================================

bot.action('admin_broadcast', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    await ctx.editMessageText('📢 *Broadcast Message*\n\nSend the message you want to broadcast to all users.\n\nType "cancel" to cancel.', { parse_mode: 'Markdown' });
    await ctx.scene.enter('broadcast_scene');
});

scenes.broadcast.on('message', async (ctx) => {
    try {
        if (ctx.message.text?.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Broadcast cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const users = await db.collection('users').find({}).toArray();
        const totalUsers = users.length;
        let successful = 0;
        let failed = 0;
        
        await ctx.reply(`🚀 Broadcasting to ${totalUsers} users...`);
        
        for (const user of users) {
            try {
                if (ctx.message.photo) {
                    await ctx.telegram.sendPhoto(
                        user.userId,
                        ctx.message.photo[ctx.message.photo.length - 1].file_id,
                        {
                            caption: ctx.message.caption,
                            parse_mode: 'Markdown'
                        }
                    );
                } else if (ctx.message.document) {
                    await ctx.telegram.sendDocument(
                        user.userId,
                        ctx.message.document.file_id,
                        {
                            caption: ctx.message.caption,
                            parse_mode: 'Markdown'
                        }
                    );
                } else if (ctx.message.text) {
                    await ctx.telegram.sendMessage(
                        user.userId,
                        ctx.message.text,
                        { parse_mode: 'Markdown' }
                    );
                }
                
                successful++;
                await new Promise(resolve => setTimeout(resolve, 50));
            } catch (error) {
                failed++;
            }
        }
        
        await ctx.reply(
            `✅ *Broadcast Complete*\n\n📊 Statistics:\n• Total: ${totalUsers}\n• ✅ Successful: ${successful}\n• ❌ Failed: ${failed}`,
            { parse_mode: 'Markdown' }
        );
        
    } catch (error) {
        console.error('Broadcast error:', error);
        await ctx.reply('❌ Broadcast failed.');
    }
    
    await ctx.scene.leave();
    await showAdminPanel(ctx);
});

// ==========================================
// ADMIN FEATURES - USER STATS
// ==========================================

bot.action('admin_userstats', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const users = await db.collection('users').find({}).toArray();
        const totalUsers = users.length;
        const verifiedUsers = users.filter(u => u.joinedAll).length;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const activeToday = users.filter(u => u.lastActive && new Date(u.lastActive) >= today).length;
        
        let recentUsersText = '';
        const recentUsers = users
            .sort((a, b) => new Date(b.joinedAt || 0) - new Date(a.joinedAt || 0))
            .slice(0, 5);
        
        recentUsers.forEach((user, index) => {
            const username = user.username ? `@${user.username}` : user.firstName || 'Unknown';
            const status = user.joinedAll ? '✅' : '❌';
            recentUsersText += `${index + 1}. [${username}](tg://user?id=${user.userId}) ${status} `;
            recentUsersText += `[💬](tg://user?id=${ctx.from.id}?start=contact_${user.userId})\n`;
        });
        
        const text = `📊 *User Statistics*\n\n` +
                     `• Total Users: ${totalUsers}\n` +
                     `• Verified Users: ${verifiedUsers}\n` +
                     `• Active Today: ${activeToday}\n\n` +
                     `👥 *Recent Users (5)*:\n${recentUsersText}`;
        
        const keyboard = [[{ text: '🔙 Back', callback_data: 'admin_back' }]];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('User stats error:', error);
        await ctx.reply('❌ Failed to get user statistics.');
    }
});

// ==========================================
// ADMIN FEATURES - START IMAGE
// ==========================================

bot.action('admin_startimage', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentImage = config?.startImage || DEFAULT_CONFIG.startImage;
        
        const text = `🖼️ *Start Image Management*\n\nCurrent Image:\n\`${currentImage}\`\n\nSelect an option:`;
        
        const keyboard = [
            [{ text: '✏️ Edit Image URL', callback_data: 'admin_edit_startimage' }, { text: '📤 Upload Image', callback_data: 'admin_upload_startimage' }],
            [{ text: '🔄 Reset to Default', callback_data: 'admin_reset_startimage' }, { text: '🔙 Back', callback_data: 'admin_back' }]
        ];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Start image menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

bot.action('admin_edit_startimage', async (ctx) => {
    await ctx.reply('Enter the new image URL:\n\nType "cancel" to cancel.');
    await ctx.scene.enter('edit_start_image_scene');
});

scenes.editStartImage.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Edit cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const newUrl = ctx.message.text.trim();
        
        if (!newUrl.startsWith('http')) {
            await ctx.reply('❌ Invalid URL. Must start with http:// or https://');
            return;
        }
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { startImage: newUrl, updatedAt: new Date() } }
        );
        
        await ctx.reply('✅ Start image updated!');
        await ctx.scene.leave();
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Edit start image error:', error);
        await ctx.reply('❌ Failed to update image.');
        await ctx.scene.leave();
    }
});

scenes.editStartImage.on('photo', async (ctx) => {
    try {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const fileLink = await ctx.telegram.getFileLink(photo.file_id);
        const response = await fetch(fileLink);
        
        if (!response.ok) throw new Error('Failed to fetch image');
        
        const buffer = await response.buffer();
        
        // Upload to Cloudinary without name overlay
        const result = await uploadToCloudinary(buffer, 'start_images');
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { startImage: result.secure_url, updatedAt: new Date() } }
        );
        
        await ctx.reply('✅ Image uploaded and set as start image!');
        await ctx.scene.leave();
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Upload image error:', error);
        await ctx.reply('❌ Failed to upload image.');
        await ctx.scene.leave();
    }
});

bot.action('admin_upload_startimage', async (ctx) => {
    await ctx.reply('Send the image you want to upload:\n\nType "cancel" to cancel.');
    await ctx.scene.enter('edit_start_image_scene');
});

bot.action('admin_reset_startimage', async (ctx) => {
    try {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { startImage: DEFAULT_CONFIG.startImage, updatedAt: new Date() } }
        );
        
        await ctx.answerCbQuery('✅ Start image reset to default');
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Reset start image error:', error);
        await ctx.answerCbQuery('❌ Failed to reset image');
    }
});

// ==========================================
// ADMIN FEATURES - START MESSAGE
// ==========================================

bot.action('admin_startmessage', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentMessage = config?.startMessage || DEFAULT_CONFIG.startMessage;
        
        const text = `📝 *Start Message Management*\n\nCurrent Message:\n\`\`\`\n${currentMessage}\n\`\`\`\n\nSelect an option:`;
        
        const keyboard = [
            [{ text: '✏️ Edit Message', callback_data: 'admin_edit_startmessage' }, { text: '🔄 Reset to Default', callback_data: 'admin_reset_startmessage' }],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
        ];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Start message menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

bot.action('admin_edit_startmessage', async (ctx) => {
    await ctx.reply('Enter the new start message:\n\nType "cancel" to cancel.');
    await ctx.scene.enter('edit_start_message_scene');
});

scenes.editStartMessage.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Edit cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { startMessage: ctx.message.text, updatedAt: new Date() } }
        );
        
        await ctx.reply('✅ Start message updated!');
        await ctx.scene.leave();
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Edit start message error:', error);
        await ctx.reply('❌ Failed to update message.');
        await ctx.scene.leave();
    }
});

bot.action('admin_reset_startmessage', async (ctx) => {
    try {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { startMessage: DEFAULT_CONFIG.startMessage, updatedAt: new Date() } }
        );
        
        await ctx.answerCbQuery('✅ Start message reset to default');
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Reset start message error:', error);
        await ctx.answerCbQuery('❌ Failed to reset message');
    }
});

// ==========================================
// ADMIN FEATURES - MENU IMAGE & MESSAGE
// ==========================================

// Menu Image (similar to start image)
bot.action('admin_menuimage', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentImage = config?.menuImage || DEFAULT_CONFIG.menuImage;
        
        const text = `🖼️ *Menu Image Management*\n\nCurrent Image:\n\`${currentImage}\`\n\nSelect an option:`;
        
        const keyboard = [
            [{ text: '✏️ Edit Image URL', callback_data: 'admin_edit_menuimage' }, { text: '📤 Upload Image', callback_data: 'admin_upload_menuimage' }],
            [{ text: '🔄 Reset to Default', callback_data: 'admin_reset_menuimage' }, { text: '🔙 Back', callback_data: 'admin_back' }]
        ];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Menu image menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

// Menu Message (similar to start message)
bot.action('admin_menumessage', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentMessage = config?.menuMessage || DEFAULT_CONFIG.menuMessage;
        
        const text = `📝 *Menu Message Management*\n\nCurrent Message:\n\`\`\`\n${currentMessage}\n\`\`\`\n\nSelect an option:`;
        
        const keyboard = [
            [{ text: '✏️ Edit Message', callback_data: 'admin_edit_menumessage' }, { text: '🔄 Reset to Default', callback_data: 'admin_reset_menumessage' }],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
        ];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Menu message menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

// ==========================================
// ADMIN FEATURES - CODE TIMER
// ==========================================

bot.action('admin_timer', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentTimer = config?.codeTimer || DEFAULT_CONFIG.codeTimer;
        const hours = Math.floor(currentTimer / 3600);
        
        const text = `⏰ *Code Timer Settings*\n\nCurrent timer: *${hours} hours*\n\nSelect an option:`;
        
        const keyboard = [
            [{ text: '2 Hours', callback_data: 'timer_2' }, { text: '4 Hours', callback_data: 'timer_4' }],
            [{ text: '6 Hours', callback_data: 'timer_6' }, { text: '12 Hours', callback_data: 'timer_12' }],
            [{ text: '24 Hours', callback_data: 'timer_24' }, { text: '✏️ Custom', callback_data: 'timer_custom' }],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
        ];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Timer menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

// Timer handlers
['2', '4', '6', '12', '24'].forEach(hours => {
    bot.action(`timer_${hours}`, async (ctx) => {
        try {
            const seconds = parseInt(hours) * 3600;
            await db.collection('admin').updateOne(
                { type: 'config' },
                { $set: { codeTimer: seconds, updatedAt: new Date() } }
            );
            
            await ctx.answerCbQuery(`✅ Timer set to ${hours} hours`);
            await showAdminPanel(ctx);
        } catch (error) {
            console.error(`Set timer ${hours} error:`, error);
            await ctx.answerCbQuery('❌ Failed to set timer');
        }
    });
});

bot.action('timer_custom', async (ctx) => {
    await ctx.reply('Enter timer in hours (e.g., 3 for 3 hours):\n\nType "cancel" to cancel.');
    await ctx.scene.enter('edit_timer_scene');
});

scenes.editTimer.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Edit cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const hours = parseInt(ctx.message.text);
        if (isNaN(hours) || hours < 1) {
            await ctx.reply('❌ Please enter a valid number of hours (minimum 1).');
            return;
        }
        
        const seconds = hours * 3600;
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { codeTimer: seconds, updatedAt: new Date() } }
        );
        
        await ctx.reply(`✅ Timer set to ${hours} hours`);
        await ctx.scene.leave();
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Edit timer error:', error);
        await ctx.reply('❌ Failed to set timer.');
        await ctx.scene.leave();
    }
});

// ==========================================
// ADMIN FEATURES - CHANNEL MANAGEMENT (FIXED)
// ==========================================

bot.action('admin_channels', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const channels = config?.channels || [];
        
        let text = '📺 *Manage Channels*\n\n';
        
        if (channels.length === 0) {
            text += 'No channels added yet.\n';
        } else {
            channels.forEach((channel, index) => {
                text += `${index + 1}. ${channel.buttonLabel || channel.title}\n`;
            });
        }
        
        text += '\nSelect an option:';
        
        const keyboard = [
            [{ text: '➕ Add Channel', callback_data: 'admin_add_channel' }],
            channels.length > 0 ? [{ text: '🗑️ Delete Channel', callback_data: 'admin_delete_channel' }] : [],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
        ].filter(row => row.length > 0);
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Channels menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

// Add Channel - FIXED
bot.action('admin_add_channel', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    await ctx.reply('Enter channel button name (e.g., "Join Main Channel"):\n\nType "cancel" to cancel.');
    await ctx.scene.enter('add_channel_name_scene');
});

scenes.addChannelName.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Add cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        // Store button label in session
        ctx.session.channelData = {
            buttonLabel: ctx.message.text
        };
        
        await ctx.reply('Now send the channel ID (e.g., -1001234567890) or username (e.g., @channelname):\n\nYou can also forward a message from the channel.');
        await ctx.scene.leave();
        await ctx.scene.enter('add_channel_id_scene');
    } catch (error) {
        console.error('Add channel name error:', error);
        await ctx.reply('❌ An error occurred.');
        await ctx.scene.leave();
    }
});

scenes.addChannelId.on(['text', 'forward_date'], async (ctx) => {
    try {
        if (!ctx.session.channelData) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const buttonLabel = ctx.session.channelData.buttonLabel;
        let channelIdentifier;
        
        if (ctx.message.forward_from_chat) {
            channelIdentifier = ctx.message.forward_from_chat.id;
        } else if (ctx.message.text) {
            channelIdentifier = ctx.message.text.trim();
        } else {
            await ctx.reply('❌ Please send a valid channel ID or forward a message.');
            return;
        }
        
        // Try to get chat info
        let chat;
        try {
            chat = await ctx.telegram.getChat(channelIdentifier);
        } catch (error) {
            await ctx.reply(`❌ Error: ${error.message}\n\nPlease make sure the bot is added to the channel and is admin.`);
            return;
        }
        
        // Check if bot is admin
        try {
            const member = await ctx.telegram.getChatMember(chat.id, ctx.botInfo.id);
            if (member.status !== 'administrator') {
                await ctx.reply('❌ Bot must be admin in the channel.\nMake bot admin and try again.');
                await ctx.scene.leave();
                await showAdminPanel(ctx);
                return;
            }
        } catch (error) {
            await ctx.reply('❌ Bot must be admin in the channel.\nMake bot admin and try again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        // Get invite link
        let link;
        try {
            if (chat.username) {
                link = `https://t.me/${chat.username}`;
            } else {
                link = await ctx.telegram.exportChatInviteLink(chat.id);
            }
        } catch (error) {
            link = `https://t.me/c/${String(chat.id).slice(4)}`;
        }
        
        // Create channel object
        const newChannel = {
            id: chat.id,
            title: chat.title || 'Unknown Channel',
            buttonLabel: buttonLabel,
            link: link,
            type: chat.username ? 'public' : 'private',
            addedAt: new Date()
        };
        
        // Add to database
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { channels: newChannel } }
        );
        
        await ctx.reply(`✅ Channel added successfully!\n\n• Name: ${buttonLabel}\n• ID: ${chat.id}\n• Link: ${link}`);
        
        // Clear session
        delete ctx.session.channelData;
        
    } catch (error) {
        console.error('Add channel error:', error);
        await ctx.reply(`❌ Error: ${error.message}\n\nPlease try again.`);
    }
    
    await ctx.scene.leave();
    await showAdminPanel(ctx);
});

// Delete Channel
bot.action('admin_delete_channel', async (ctx) => {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const channels = config?.channels || [];
        
        if (channels.length === 0) {
            await ctx.answerCbQuery('No channels to delete.');
            return;
        }
        
        let text = '🗑️ *Delete Channel*\n\nSelect a channel to delete:';
        const keyboard = [];
        
        channels.forEach((channel, index) => {
            keyboard.push([{ 
                text: `${index + 1}. ${channel.buttonLabel || channel.title}`, 
                callback_data: `delete_channel_${channel.id}` 
            }]);
        });
        
        keyboard.push([{ text: '🔙 Back', callback_data: 'admin_channels' }]);
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Delete channel menu error:', error);
        await ctx.answerCbQuery('❌ Failed to load channels');
    }
});

bot.action(/^delete_channel_(.+)$/, async (ctx) => {
    try {
        const channelId = ctx.match[1];
        const config = await db.collection('admin').findOne({ type: 'config' });
        const channels = config?.channels || [];
        
        const newChannels = channels.filter(channel => String(channel.id) !== String(channelId));
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { channels: newChannels, updatedAt: new Date() } }
        );
        
        await ctx.answerCbQuery('✅ Channel deleted');
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Delete channel error:', error);
        await ctx.answerCbQuery('❌ Failed to delete channel');
    }
});

// ==========================================
// ADMIN FEATURES - APP MANAGEMENT (FIXED)
// ==========================================

bot.action('admin_apps', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const apps = config?.apps || [];
        
        let text = '📱 *Manage Apps*\n\n';
        
        if (apps.length === 0) {
            text += 'No apps added yet.\n';
        } else {
            apps.forEach((app, index) => {
                text += `${index + 1}. ${app.name} (${app.codeCount || 1} codes)\n`;
            });
        }
        
        text += '\nSelect an option:';
        
        const keyboard = [
            [{ text: '➕ Add App', callback_data: 'admin_add_app' }],
            apps.length > 0 ? [{ text: '🗑️ Delete App', callback_data: 'admin_delete_app' }] : [],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
        ].filter(row => row.length > 0);
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Apps menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

// Add App - FIXED
bot.action('admin_add_app', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    await ctx.reply('Enter app name (e.g., "WhatsApp Agents"):\n\nType "cancel" to cancel.');
    await ctx.scene.enter('add_app_name_scene');
});

scenes.addAppName.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Add cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        // Store app data in session
        ctx.session.appData = {
            name: ctx.message.text
        };
        
        await ctx.reply('Send app image URL or photo (or send "none" for no image):');
        await ctx.scene.leave();
        await ctx.scene.enter('add_app_image_scene');
    } catch (error) {
        console.error('Add app name error:', error);
        await ctx.reply('❌ An error occurred.');
        await ctx.scene.leave();
    }
});

scenes.addAppImage.on(['text', 'photo'], async (ctx) => {
    try {
        if (!ctx.session.appData) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        if (ctx.message.text && ctx.message.text.toLowerCase() === 'none') {
            ctx.session.appData.image = 'none';
        } else if (ctx.message.photo) {
            const photo = ctx.message.photo[ctx.message.photo.length - 1];
            const fileLink = await ctx.telegram.getFileLink(photo.file_id);
            const response = await fetch(fileLink);
            
            if (!response.ok) throw new Error('Failed to fetch image');
            
            const buffer = await response.buffer();
            
            // Upload to Cloudinary
            const result = await uploadToCloudinary(buffer, 'app_images');
            ctx.session.appData.image = result.secure_url;
            ctx.session.appData.cloudinaryId = result.public_id;
        } else if (ctx.message.text) {
            ctx.session.appData.image = ctx.message.text;
        } else {
            await ctx.reply('❌ Please send an image or "none".');
            return;
        }
        
        await ctx.reply('How many codes to generate? (1-10):');
        await ctx.scene.leave();
        await ctx.scene.enter('add_app_code_count_scene');
    } catch (error) {
        console.error('Add app image error:', error);
        await ctx.reply('❌ Failed to process image. Please try again.');
        await ctx.scene.leave();
    }
});

scenes.addAppCodeCount.on('text', async (ctx) => {
    try {
        if (!ctx.session.appData) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const count = parseInt(ctx.message.text);
        if (isNaN(count) || count < 1 || count > 10) {
            await ctx.reply('❌ Please enter a number between 1 and 10.');
            return;
        }
        
        ctx.session.appData.codeCount = count;
        
        await ctx.reply('Enter prefixes for each code (separated by commas):\nExample: XY,AB,CD\nLeave empty for no prefixes.');
        await ctx.scene.leave();
        await ctx.scene.enter('add_app_code_prefixes_scene');
    } catch (error) {
        console.error('Add app code count error:', error);
        await ctx.reply('❌ An error occurred.');
        await ctx.scene.leave();
    }
});

scenes.addAppCodePrefixes.on('text', async (ctx) => {
    try {
        if (!ctx.session.appData) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const prefixes = ctx.message.text.split(',').map(p => p.trim()).filter(p => p);
        ctx.session.appData.codePrefixes = prefixes;
        
        await ctx.reply('Enter code lengths for each code (separated by commas, min 6):\nExample: 8,10,12\nDefault is 8 for all codes.');
        await ctx.scene.leave();
        await ctx.scene.enter('add_app_code_lengths_scene');
    } catch (error) {
        console.error('Add app prefixes error:', error);
        await ctx.reply('❌ An error occurred.');
        await ctx.scene.leave();
    }
});

scenes.addAppCodeLengths.on('text', async (ctx) => {
    try {
        if (!ctx.session.appData) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const lengths = ctx.message.text.split(',').map(l => parseInt(l.trim())).filter(l => !isNaN(l) && l >= 6);
        ctx.session.appData.codeLengths = lengths;
        
        await ctx.reply('Enter the code message template:\n\nAvailable variables:\n{first_name}, {last_name}, {full_name}, {username}, {name}\n{app_name}, {button_name}\n{code1}, {code2}, ... {code10}\n\nExample: "Your codes for {app_name} are:\n{code1}\n{code2}"');
        await ctx.scene.leave();
        await ctx.scene.enter('add_app_code_message_scene');
    } catch (error) {
        console.error('Add app lengths error:', error);
        await ctx.reply('❌ An error occurred.');
        await ctx.scene.leave();
    }
});

scenes.addAppCodeMessage.on('text', async (ctx) => {
    try {
        if (!ctx.session.appData) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const appData = ctx.session.appData;
        
        // Create app object
        const app = {
            id: `app_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: appData.name,
            image: appData.image || 'none',
            codeCount: appData.codeCount || 1,
            codePrefixes: appData.codePrefixes || [],
            codeLengths: appData.codeLengths || Array(appData.codeCount || 1).fill(8),
            codeMessage: ctx.message.text || 'Your code: {code1}',
            cloudinaryId: appData.cloudinaryId,
            createdAt: new Date()
        };
        
        // Ensure arrays have correct length
        while (app.codePrefixes.length < app.codeCount) {
            app.codePrefixes.push('');
        }
        
        while (app.codeLengths.length < app.codeCount) {
            app.codeLengths.push(8);
        }
        
        // Add to database
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $push: { apps: app } }
        );
        
        await ctx.reply(`✅ App "${app.name}" added successfully!\n\n• Codes: ${app.codeCount}\n• Image: ${app.image === 'none' ? 'None' : 'Set'}`);
        
        // Clear session
        delete ctx.session.appData;
        
    } catch (error) {
        console.error('Add app message error:', error);
        await ctx.reply('❌ Failed to add app. Please try again.');
    }
    
    await ctx.scene.leave();
    await showAdminPanel(ctx);
});

// Delete App
bot.action('admin_delete_app', async (ctx) => {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const apps = config?.apps || [];
        
        if (apps.length === 0) {
            await ctx.answerCbQuery('No apps to delete.');
            return;
        }
        
        let text = '🗑️ *Delete App*\n\nSelect an app to delete:';
        const keyboard = [];
        
        apps.forEach((app, index) => {
            keyboard.push([{ 
                text: `${index + 1}. ${app.name}`, 
                callback_data: `delete_app_${app.id}` 
            }]);
        });
        
        keyboard.push([{ text: '🔙 Back', callback_data: 'admin_apps' }]);
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Delete app menu error:', error);
        await ctx.answerCbQuery('❌ Failed to load apps');
    }
});

bot.action(/^delete_app_(.+)$/, async (ctx) => {
    try {
        const appId = ctx.match[1];
        const config = await db.collection('admin').findOne({ type: 'config' });
        const apps = config?.apps || [];
        
        // Find app to get cloudinary ID
        const appToDelete = apps.find(app => app.id === appId);
        
        // Delete from Cloudinary if exists
        if (appToDelete?.cloudinaryId) {
            try {
                await cloudinary.uploader.destroy(appToDelete.cloudinaryId);
            } catch (error) {
                console.error('Failed to delete from Cloudinary:', error);
            }
        }
        
        const newApps = apps.filter(app => app.id !== appId);
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { apps: newApps, updatedAt: new Date() } }
        );
        
        await ctx.answerCbQuery('✅ App deleted');
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Delete app error:', error);
        await ctx.answerCbQuery('❌ Failed to delete app');
    }
});

// ==========================================
// ADMIN FEATURES - CONTACT USER (NEW FEATURE)
// ==========================================

bot.action('admin_contact_user', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    await ctx.reply('Enter username or user ID to contact:\n\nType "cancel" to cancel.');
    await ctx.scene.enter('contact_user_scene');
});

scenes.contactUser.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Contact cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        // Store user identifier in session
        ctx.session.contactUser = {
            identifier: ctx.message.text.trim()
        };
        
        await ctx.reply('Now send the message you want to send (text, photo, or document):\n\nType "cancel" to cancel.');
        await ctx.scene.leave();
        await ctx.scene.enter('contact_user_message_scene');
    } catch (error) {
        console.error('Contact user error:', error);
        await ctx.reply('❌ An error occurred.');
        await ctx.scene.leave();
    }
});

scenes.contactUserMessage.on(['text', 'photo', 'document'], async (ctx) => {
    try {
        if (!ctx.session.contactUser) {
            await ctx.reply('❌ Session expired. Please start again.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const identifier = ctx.session.contactUser.identifier;
        let userId;
        
        // Try to resolve identifier
        if (identifier.startsWith('@')) {
            // Username
            try {
                const user = await ctx.telegram.getChat(identifier);
                userId = user.id;
            } catch (error) {
                await ctx.reply('❌ Cannot find user with that username.');
                delete ctx.session.contactUser;
                await ctx.scene.leave();
                await showAdminPanel(ctx);
                return;
            }
        } else {
            // User ID
            userId = parseInt(identifier);
            if (isNaN(userId)) {
                await ctx.reply('❌ Invalid user ID. Please enter a numeric ID or username starting with @.');
                delete ctx.session.contactUser;
                await ctx.scene.leave();
                await showAdminPanel(ctx);
                return;
            }
        }
        
        // Try to send message
        try {
            if (ctx.message.photo) {
                await ctx.telegram.sendPhoto(
                    userId,
                    ctx.message.photo[ctx.message.photo.length - 1].file_id,
                    {
                        caption: ctx.message.caption || '',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '📩 Reply to Admin', callback_data: `reply_to_admin_${ctx.from.id}` }
                            ]]
                        }
                    }
                );
            } else if (ctx.message.document) {
                await ctx.telegram.sendDocument(
                    userId,
                    ctx.message.document.file_id,
                    {
                        caption: ctx.message.caption || '',
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '📩 Reply to Admin', callback_data: `reply_to_admin_${ctx.from.id}` }
                            ]]
                        }
                    }
                );
            } else if (ctx.message.text) {
                await ctx.telegram.sendMessage(
                    userId,
                    ctx.message.text,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '📩 Reply to Admin', callback_data: `reply_to_admin_${ctx.from.id}` }
                            ]]
                        }
                    }
                );
            }
            
            await ctx.reply(`✅ Message sent to user ${identifier}`);
            
        } catch (error) {
            await ctx.reply(`❌ Failed to send message: ${error.message}`);
        }
        
        // Clear session
        delete ctx.session.contactUser;
        
    } catch (error) {
        console.error('Contact user message error:', error);
        await ctx.reply('❌ An error occurred.');
    }
    
    await ctx.scene.leave();
    await showAdminPanel(ctx);
});

// Handle reply to admin
bot.action(/^reply_to_admin_(.+)$/, async (ctx) => {
    try {
        const adminId = ctx.match[1];
        
        // Store admin ID in session
        ctx.session.replyToAdmin = {
            adminId: adminId
        };
        
        await ctx.reply('Type your reply to the admin:\n\nType "cancel" to cancel.');
        await ctx.scene.enter('reply_to_user_scene');
    } catch (error) {
        console.error('Reply to admin error:', error);
        await ctx.answerCbQuery('❌ Error');
    }
});

scenes.replyToUser.on(['text', 'photo', 'document'], async (ctx) => {
    try {
        if (!ctx.session.replyToAdmin) {
            await ctx.reply('❌ Session expired.');
            await ctx.scene.leave();
            return;
        }
        
        const adminId = ctx.session.replyToAdmin.adminId;
        const fromUser = ctx.from;
        const userInfo = `From: ${fromUser.first_name || ''} ${fromUser.last_name || ''} (@${fromUser.username || 'no_username'}) ID: ${fromUser.id}`;
        
        // Send to admin
        try {
            if (ctx.message.photo) {
                await ctx.telegram.sendPhoto(
                    adminId,
                    ctx.message.photo[ctx.message.photo.length - 1].file_id,
                    {
                        caption: `${userInfo}\n\n${ctx.message.caption || ''}`,
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💬 Reply Back', callback_data: `contact_user_${fromUser.id}` }
                            ]]
                        }
                    }
                );
            } else if (ctx.message.document) {
                await ctx.telegram.sendDocument(
                    adminId,
                    ctx.message.document.file_id,
                    {
                        caption: `${userInfo}\n\n${ctx.message.caption || ''}`,
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💬 Reply Back', callback_data: `contact_user_${fromUser.id}` }
                            ]]
                        }
                    }
                );
            } else if (ctx.message.text) {
                await ctx.telegram.sendMessage(
                    adminId,
                    `${userInfo}\n\n${ctx.message.text}`,
                    {
                        reply_markup: {
                            inline_keyboard: [[
                                { text: '💬 Reply Back', callback_data: `contact_user_${fromUser.id}` }
                            ]]
                        }
                    }
                );
            }
            
            await ctx.reply('✅ Your reply has been sent to the admin.');
            
        } catch (error) {
            await ctx.reply('❌ Failed to send reply.');
        }
        
        // Clear session
        delete ctx.session.replyToAdmin;
        
    } catch (error) {
        console.error('Reply to user error:', error);
        await ctx.reply('❌ An error occurred.');
    }
    
    await ctx.scene.leave();
});

// Handle contact user from button
bot.action(/^contact_user_(.+)$/, async (ctx) => {
    try {
        const userId = ctx.match[1];
        
        // Store user ID in session
        ctx.session.contactUser = {
            identifier: userId
        };
        
        await ctx.reply(`Now send the message to user ID: ${userId}\n\nType "cancel" to cancel.`);
        await ctx.scene.enter('contact_user_message_scene');
    } catch (error) {
        console.error('Contact user from button error:', error);
        await ctx.answerCbQuery('❌ Error');
    }
});

// ==========================================
// ADMIN FEATURES - MANAGE ADMINS
// ==========================================

bot.action('admin_manage_admins', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const admins = config?.admins || ADMIN_IDS;
        
        let text = '👑 *Manage Admins*\n\nCurrent Admins:\n';
        
        admins.forEach((adminId, index) => {
            text += `${index + 1}. \`${adminId}\`\n`;
        });
        
        text += '\nSelect an option:';
        
        const keyboard = [
            [{ text: '➕ Add Admin', callback_data: 'admin_add_admin' }, { text: '🗑️ Remove Admin', callback_data: 'admin_remove_admin' }],
            [{ text: '🔙 Back', callback_data: 'admin_back' }]
        ];
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Manage admins menu error:', error);
        await ctx.reply('❌ An error occurred.');
    }
});

// Add Admin
bot.action('admin_add_admin', async (ctx) => {
    await ctx.reply('Send the user ID of the new admin:\n\nType "cancel" to cancel.');
    await ctx.scene.enter('add_admin_scene');
});

scenes.addAdmin.on('text', async (ctx) => {
    try {
        if (ctx.message.text.toLowerCase() === 'cancel') {
            await ctx.reply('❌ Add cancelled.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const newAdminId = parseInt(ctx.message.text);
        if (isNaN(newAdminId)) {
            await ctx.reply('❌ Invalid user ID. Please enter a numeric ID.');
            return;
        }
        
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentAdmins = config?.admins || ADMIN_IDS;
        
        if (currentAdmins.includes(newAdminId)) {
            await ctx.reply('❌ This user is already an admin.');
            await ctx.scene.leave();
            await showAdminPanel(ctx);
            return;
        }
        
        const updatedAdmins = [...currentAdmins, newAdminId];
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { admins: updatedAdmins, updatedAt: new Date() } }
        );
        
        await ctx.reply(`✅ Admin added successfully!\n\nNew admin ID: \`${newAdminId}\``);
        
    } catch (error) {
        console.error('Add admin error:', error);
        await ctx.reply('❌ Failed to add admin.');
    }
    
    await ctx.scene.leave();
    await showAdminPanel(ctx);
});

// Remove Admin (simplified)
bot.action('admin_remove_admin', async (ctx) => {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const admins = config?.admins || ADMIN_IDS;
        
        if (admins.length <= 1) {
            await ctx.answerCbQuery('❌ Cannot remove last admin.');
            return;
        }
        
        let text = '🗑️ *Remove Admin*\n\nSelect an admin to remove:';
        const keyboard = [];
        
        admins.forEach((adminId, index) => {
            // Don't allow removing yourself
            if (String(adminId) !== String(ctx.from.id)) {
                keyboard.push([{ 
                    text: `${index + 1}. ${adminId}`, 
                    callback_data: `remove_admin_${adminId}` 
                }]);
            }
        });
        
        keyboard.push([{ text: '🔙 Back', callback_data: 'admin_manage_admins' }]);
        
        await ctx.editMessageText(text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Remove admin menu error:', error);
        await ctx.answerCbQuery('❌ Failed to load admins');
    }
});

bot.action(/^remove_admin_(.+)$/, async (ctx) => {
    try {
        const adminId = parseInt(ctx.match[1]);
        
        // Prevent removing yourself
        if (String(adminId) === String(ctx.from.id)) {
            await ctx.answerCbQuery('❌ Cannot remove yourself.');
            return;
        }
        
        const config = await db.collection('admin').findOne({ type: 'config' });
        const currentAdmins = config?.admins || ADMIN_IDS;
        
        const updatedAdmins = currentAdmins.filter(id => id !== adminId);
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { admins: updatedAdmins, updatedAt: new Date() } }
        );
        
        await ctx.answerCbQuery('✅ Admin removed');
        await showAdminPanel(ctx);
    } catch (error) {
        console.error('Remove admin error:', error);
        await ctx.answerCbQuery('❌ Failed to remove admin');
    }
});

// ==========================================
// ADMIN FEATURES - DELETE DATA
// ==========================================

bot.action('admin_deletedata', async (ctx) => {
    if (!await isAdmin(ctx.from.id)) return;
    
    const text = '⚠️ *DANGER ZONE - DATA DELETION*\n\nSelect what you want to delete:\n\n*WARNING: These actions cannot be undone!*';
    
    const keyboard = [
        [{ text: '🗑️ Delete All Users', callback_data: 'delete_all_users' }, { text: '🗑️ Delete All Channels', callback_data: 'delete_all_channels' }],
        [{ text: '🗑️ Delete All Apps', callback_data: 'delete_all_apps' }, { text: '🔥 DELETE EVERYTHING', callback_data: 'delete_everything' }],
        [{ text: '🔙 Back', callback_data: 'admin_back' }]
    ];
    
    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
    });
});

// Delete All Users
bot.action('delete_all_users', async (ctx) => {
    const keyboard = [
        [{ text: '✅ YES, DELETE ALL USERS', callback_data: 'confirm_delete_users' }],
        [{ text: '❌ NO, CANCEL', callback_data: 'admin_deletedata' }]
    ];
    
    await ctx.editMessageText(
        '⚠️ *CONFIRMATION REQUIRED*\n\nAre you sure you want to delete ALL users?\n\nThis will remove all user data.\n\n*This action cannot be undone!*',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        }
    );
});

bot.action('confirm_delete_users', async (ctx) => {
    try {
        const result = await db.collection('users').deleteMany({});
        await ctx.editMessageText(`✅ Deleted ${result.deletedCount} users.`, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    } catch (error) {
        console.error('Delete users error:', error);
        await ctx.editMessageText('❌ Failed to delete users.', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    }
});

// Delete All Channels
bot.action('delete_all_channels', async (ctx) => {
    const keyboard = [
        [{ text: '✅ YES, DELETE ALL CHANNELS', callback_data: 'confirm_delete_channels' }],
        [{ text: '❌ NO, CANCEL', callback_data: 'admin_deletedata' }]
    ];
    
    await ctx.editMessageText(
        '⚠️ *CONFIRMATION REQUIRED*\n\nAre you sure you want to delete ALL channels?\n\nThis will remove all channel data.\n\n*This action cannot be undone!*',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        }
    );
});

bot.action('confirm_delete_channels', async (ctx) => {
    try {
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { channels: [], updatedAt: new Date() } }
        );
        
        await ctx.editMessageText('✅ All channels deleted.', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    } catch (error) {
        console.error('Delete channels error:', error);
        await ctx.editMessageText('❌ Failed to delete channels.', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    }
});

// Delete All Apps
bot.action('delete_all_apps', async (ctx) => {
    const keyboard = [
        [{ text: '✅ YES, DELETE ALL APPS', callback_data: 'confirm_delete_apps' }],
        [{ text: '❌ NO, CANCEL', callback_data: 'admin_deletedata' }]
    ];
    
    await ctx.editMessageText(
        '⚠️ *CONFIRMATION REQUIRED*\n\nAre you sure you want to delete ALL apps?\n\nThis will remove all app data.\n\n*This action cannot be undone!*',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        }
    );
});

bot.action('confirm_delete_apps', async (ctx) => {
    try {
        const config = await db.collection('admin').findOne({ type: 'config' });
        const apps = config?.apps || [];
        
        // Delete images from Cloudinary
        for (const app of apps) {
            if (app.cloudinaryId) {
                try {
                    await cloudinary.uploader.destroy(app.cloudinaryId);
                } catch (error) {
                    console.error('Failed to delete image:', error);
                }
            }
        }
        
        await db.collection('admin').updateOne(
            { type: 'config' },
            { $set: { apps: [], updatedAt: new Date() } }
        );
        
        await ctx.editMessageText('✅ All apps deleted.', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    } catch (error) {
        console.error('Delete apps error:', error);
        await ctx.editMessageText('❌ Failed to delete apps.', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    }
});

// Delete Everything (FIXED)
bot.action('delete_everything', async (ctx) => {
    const keyboard = [
        [{ text: '🔥 YES, DELETE EVERYTHING', callback_data: 'confirm_delete_everything' }],
        [{ text: '❌ NO, CANCEL', callback_data: 'admin_deletedata' }]
    ];
    
    await ctx.editMessageText(
        '🚨 *EXTREME DANGER*\n\nAre you absolutely sure you want to DELETE EVERYTHING?\n\nThis will remove ALL data and reset the bot.\n\n*COMPLETE RESET - IRREVERSIBLE!*',
        {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        }
    );
});

bot.action('confirm_delete_everything', async (ctx) => {
    try {
        // Delete users
        await db.collection('users').deleteMany({});
        
        // Delete config
        await db.collection('admin').deleteOne({ type: 'config' });
        
        // Reinitialize
        await initBot();
        
        await ctx.editMessageText('🔥 COMPLETE RESET DONE!\n\nBot has been reset to factory settings.', {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    } catch (error) {
        console.error('Delete everything error:', error);
        await ctx.editMessageText('❌ Failed to reset bot.', {
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_back' }]]
            }
        });
    }
});

// ==========================================
// ERROR HANDLING
// ==========================================

bot.catch((error, ctx) => {
    console.error('Bot error:', error);
    try {
        if (ctx.message) {
            ctx.reply('❌ An error occurred. Please try again.');
        }
    } catch (e) {
        console.error('Error in error handler:', e);
    }
});

// ==========================================
// START BOT
// ==========================================

async function startBot() {
    try {
        // Connect to database
        const dbConnected = await connectDB();
        if (!dbConnected) {
            console.error('❌ Failed to connect to database');
            process.exit(1);
        }
        
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

console.log('Bot Starting...');
