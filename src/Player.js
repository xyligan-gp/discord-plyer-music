const { EventEmitter } = require('events');
const { Client, Guild, GuildMember, TextChannel, VoiceChannel, Message } = require('discord.js');
const ytSearch = require('yt-search');
const searchLyrics = require('lyrics-finder');
const ytdl = require('./modules/dpm-ytdl.js');
const MusicPlayerError = require('discord-player-music/src/MusicPlayerError.js');
const PlayerErrors = require('discord-player-music/src/PlayerErrors.js');
const Utils = require('discord-player-music/src/Utils.js');
const { Filters } = require('discord-player-music/structures/Player.js');

class MusicPlayer extends EventEmitter {

    /**
     * MusicPlayer Constructor
     * @param {Client} client Discord Client 
    */
    constructor(client) {
        super();

        if (!client) return new MusicPlayerError(PlayerErrors.clientNotRequired);

        this.client = client;

        /**
         * MusicPlayer Queues Map
         * @type {Map}
         */
        this.queue = new Map();

        /**
         * MusicPlayer Ready Status
         * @type {Boolean}
         */
        this.ready = false;

        /**
         * MusicPlayer Documentation Link
         * @type {String}
         */
        this.docs = 'https://dpm-docs.tk';

        /**
         * MusicPlayer Version
         * @type {String}
         */
        this.version = require('../package.json').version;

        /**
         * MusicPlayer Author
         * @type {String}
         */
        this.author = require('../package.json').author;

        /**
         * MusicPlayer Utils
         * @type {Utils}
         */
        this.utils = new Utils(client, this.queue);

        this.initPlayer();

        this.on('playerError', async data => {
            if(!data.textChannel) return;

            if(data.error.message.includes('Status code: 403')) {
                this.getGuildMap(data.textChannel.guild)
                
                .then(guildMap => {
                    this.play(data.textChannel.guild, guildMap.songs[0]);
                })
                .catch(err => {
                    return;
                })
            }else{
                const serverQueue = await this.queue.get(data.textChannel.guild.id);
                if(!serverQueue) return;

                serverQueue.voiceChannel.leave();
                this.queue.delete(data.textChannel.guild.id);
            }
        })
    }

    /**
     * Method for playing songs
     * @param {Guild} guild Discord Guild 
     * @param {Object} song Song Object 
     * @returns {void}
    */
    play(guild, song) {
        return new Promise(async (resolve, reject) => {
            const serverQueue = await this.queue.get(guild.id);
            if (!song) {
                if (!serverQueue.songs) return;
                serverQueue.voiceChannel.leave();
                return this.queue.delete(guild.id);
            }

            try {
                let stream = await this.utils.createStream(guild);

                const dispatcher = serverQueue.connection
                    .play(stream, { type: 'opus' })
                    .on("finish", () => {
                        if (serverQueue.songs.length < 1) return this.emit('queueEnded', serverQueue);
                        if (serverQueue.loop) {
                            this.play(guild, serverQueue.songs[0]);
                        } else if (serverQueue.queueLoop) {
                            let lastsong = serverQueue.songs.shift();

                            serverQueue.songs.push(lastsong);
                            this.play(guild, serverQueue.songs[0]);
                        } else {
                            serverQueue.songs.shift();
                            this.play(guild, serverQueue.songs[0]);

                            if (serverQueue.songs.length < 1) {
                                serverQueue.voiceChannel.leave();
                                this.queue.delete(guild.id);

                                return this.emit('queueEnded', serverQueue);
                            }
                        }
                    })
                    .on("error", error => {
                        return this.emit('playerError', { textChannel: song.textChannel, message: null, method: 'play', error: error });
                    });
                dispatcher.setVolumeLogarithmic(serverQueue.volume / 5);
                this.emit('playingSong', this.queue.get(guild.id));
            }catch(error){
                return this.emit('playerError', { textChannel: song.textChannel, message: null, method: 'play', error: error });
            }
        })
    }

    /**
     * Method to search for songs by user request
     * @param {GuildMember} member Discord GuildMember
     * @param {String} searchString Search String
     * @param {Message} message Discord Message
     * @returns {Promise<Array<Object>>} Returns a list of found songs
    */
    searchVideo(member, searchString, message) {
        return new Promise(async (resolve, reject) => {
            let song = {}

            if (!searchString) return reject(new MusicPlayerError(PlayerErrors.searchVideo.userRequestNotFound));

            const voiceChannel = member.voice.channel;
            if (!voiceChannel) return reject(new MusicPlayerError(PlayerErrors.voiceChannelNotFound));

            const permissions = voiceChannel.permissionsFor(this.client.user);
            if (!permissions.has('CONNECT') || !permissions.has('SPEAK')) return reject(new MusicPlayerError(PlayerErrors.permissionsNotFound.replace('{perms}', `'CONNECT' | 'SPEAK'`)));

            try {
                if (searchString.includes('https://')) {
                    const songInfo = await ytdl.getInfo(searchString);

                    song = ({
                        searchType: 'search#url',
                        title: songInfo.videoDetails.title,
                        url: songInfo.videoDetails.video_url,
                        thumbnail: songInfo.videoDetails.thumbnails[0].url,
                        author: songInfo.videoDetails.author.name,
                        textChannel: message.channel,
                        voiceChannel: message.member.voice.channel,
                        requestedBy: message.author,

                        duration: {
                            hours: this.utils.formatNumbers([Math.floor(songInfo.videoDetails.lengthSeconds / 3600)]).join(''),
                            minutes: this.utils.formatNumbers([Math.floor(songInfo.videoDetails.lengthSeconds / 60 % 60)]).join(''),
                            seconds: this.utils.formatNumbers([Math.floor(songInfo.videoDetails.lengthSeconds % 60)]).join('')
                        }
                    })

                    resolve([song]);
                    return this.addSong(1, member.guild, [song], message.channel, voiceChannel);
                } else {
                    const videoResult = await ytSearch(searchString);

                    var tracksArray = [];

                    for (let i = 0; i < 10; i++) {
                        tracksArray.push({
                            index: i + 1,
                            searchType: 'search#name',
                            title: videoResult.videos[i].title,
                            url: videoResult.videos[i].url,
                            thumbnail: videoResult.videos[i].thumbnail,
                            author: videoResult.videos[i].author.name,
                            textChannel: message.channel,
                            voiceChannel: message.member.voice.channel,
                            requestedBy: message.author,

                            duration: {
                                hours: this.utils.formatNumbers([Math.floor(videoResult.videos[i].seconds / 3600)]).join(''),
                                minutes: this.utils.formatNumbers([Math.floor(videoResult.videos[i].seconds / 60 % 60)]).join(''),
                                seconds: this.utils.formatNumbers([Math.floor(videoResult.videos[i].seconds % 60)]).join('')
                            }
                        })
                    }

                    resolve(tracksArray)
                    await this.getSongIndex(tracksArray, message);
                }
            } catch (error) {
                this.emit('playerError', { textChannel: message.channel, message: message, method: 'searchVideo', error: error });
            }
        })
    }

    /**
     * Method for getting song index
     * @param {Array<String>} tracksArray Songs Array
     * @param {Message} message Discord Message
     * @returns {Promise<Number>} Returns the position of the song from the list
    */
    getSongIndex(tracksArray, message) {
        return new Promise(async (resolve, reject) => {
            try {
                const filter = msg => msg.author.id === message.author.id;
                let collector = message.channel.createMessageCollector(filter, { time: 30000 });

                collector.on('collect', async msg => {
                    if (!isNaN(msg.content)) {
                        let number = Math.floor(msg.content);
                        if (number < 1 || number > 10) {
                            await collector.stop();
                            return this.emit('playerError', { textChannel: message.channel, message: message, method: 'searchVideo', error: new MusicPlayerError(PlayerErrors.getSongIndex.invalidTypeValue) })
                        }

                        await collector.stop();
                        resolve(number);
                        return this.addSong(number, message.guild, tracksArray, message.channel, message.member.voice.channel);
                    } else {
                        await collector.stop();
                        return this.emit('playerError', { textChannel: message.channel, message: message, method: 'searchVideo', error: new MusicPlayerError(PlayerErrors.getSongIndex.minMaxValue) })
                    }
                })
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for adding a song to the server queue
     * @param {Number} index Song Index
     * @param {Guild} guild Discord Guild
     * @param {Array<String>} tracksArray Songs Array 
     * @param {TextChannel} textChannel Discord TextChannel 
     * @param {VoiceChannel} voiceChannel Discord VoiceChannel 
     * @returns {void}
    */
    addSong(index, guild, tracksArray, textChannel, voiceChannel) {
        return new Promise(async (resolve, reject) => {
            try {
                let connection = await voiceChannel.join()
                let serverQueue = await this.queue.get(guild.id);
                let songObject = tracksArray[index - 1];

                if (!serverQueue) {
                    const queueConstruct = {
                        textChannel: textChannel,
                        voiceChannel: voiceChannel,
                        connection: connection,
                        songs: [],
                        volume: 5,
                        loop: false,
                        queueLoop: false,
                        playing: true,
                        filter: null
                    };
                    await queueConstruct.songs.push(songObject);
                    await this.queue.set(textChannel.guild.id, queueConstruct);

                    await this.play(textChannel.guild, songObject);
                    this.emit('playingSong', this.queue.get(guild.id));
                } else {
                    await serverQueue.songs.push(songObject);

                    return this.emit('songAdded', songObject);
                }
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for skipping songs in the queue
     * @param {Guild} guild Discord Guild
     * @returns {Promise<{ status: Boolean, song: Object }>} Returns an object with a skip status and a song object.
    */
    skipSong(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                if (serverQueue.songs.length < 2) {
                    serverQueue.songs = [];
                    serverQueue.voiceChannel.leave();
                    this.queue.delete(guild.id);

                    resolve({ status: true, song: null });
                }

                if (serverQueue.loop) {
                    let song = serverQueue.songs.shift();
                    serverQueue.songs.push(song);
                    serverQueue.connection.dispatcher.end();
                } else {
                    serverQueue.connection.dispatcher.end();
                }

                resolve({ status: true, song: serverQueue.songs[1] || null });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for getting a queue of server songs
     * @param {Guild} guild Discord Guild
     * @returns {Promise<Array<Object>>} Returns an array of songs being played on the server
    */
    getQueue(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                return resolve(serverQueue.songs);
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for setting the current song to repet from the server queue
     * @param {Guild} guild Discord Guild
     * @returns {Promise<{ status: Boolean, song: Object }>} Returns the song repeat status and object
    */
    setLoopSong(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                serverQueue.loop = !serverQueue.loop;
                if (serverQueue.queueLoop) serverQueue.queueLoop = !serverQueue.queueLoop;

                return resolve({ status: serverQueue.loop, song: serverQueue.songs[0] });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for setting to repeat server queue songs
     * @param {Guild} guild Discord Guild
     * @returns {Promise<{ status: Boolean, songs: Array<Object> }>} Returns the repeat status of the queue and its object
    */
     setLoopQueue(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                serverQueue.queueLoop = !serverQueue.queueLoop;
                if (serverQueue.loop) serverQueue.loop = !serverQueue.loop;

                return resolve({ status: serverQueue.queueLoop, songs: serverQueue.songs });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for ending playing a queue of songs
     * @param {Guild} guild Discord Guild 
     * @returns {Promise<Boolean>} Returns true on success
    */
    stopPlaying(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                serverQueue.songs = [];
                serverQueue.voiceChannel.leave();
                this.queue.delete(guild.id);

                return resolve(true);
            } catch (error) {
                return reject(error);
            }
        })
    }

    /**
     * Method to pause song playback
     * @param {Guild} guild Discord Guild
     * @returns {Promise<Boolean>} Returns `true` on success
    */
    pausePlaying(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                if (serverQueue && serverQueue.playing) {
                    serverQueue.playing = false;
                    serverQueue.connection.dispatcher.pause();
                    resolve(true);
                }
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method to restore playing songs
     * @param {Guild} guild Discord Guild
     * @returns {Promise<Boolean>} Returns `true` on success
    */
    resumePlaying(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                if (serverQueue && !serverQueue.playing) {
                    serverQueue.playing = true;
                    serverQueue.connection.dispatcher.resume();
                    resolve(true);
                }
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for changing the playback volume of songs
     * @param {Guild} guild Discord Guild
     * @param {Number} volumeValue Volume Value
     * @returns {Promise<{status: Boolean, volume: Number}>} Returns the volume setting status and value
    */
    setVolume(guild, volumeValue) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                if (isNaN(volumeValue)) return reject(new MusicPlayerError(PlayerErrors.setVolume.invalidTypeValue));
                let volume = Number(volumeValue);

                if (volume < 0.1) return reject(new MusicPlayerError(PlayerErrors.setVolume.minMaxValue));

                serverQueue.connection.dispatcher.setVolumeLogarithmic(volume / 5);
                serverQueue.volume = volume;

                resolve({ status: true, volume: volume });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for getting information about the current song
     * @param {Guild} guild Discord Guild
     * @returns {Promise<{ guildMap: Object, songInfo: Object }>} Returns an object with information about the current song and server queue
    */
    getCurrentSongInfo(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                let songInfo = serverQueue.songs[0];

                let songObject = ({
                    searchType: String(songInfo.searchType),
                    title: String(songInfo.title),
                    url: String(songInfo.url),
                    thumbnail: String(songInfo.thumbnail),
                    author: String(songInfo.author),
                    textChannel: songInfo.textChannel,
                    voiceChannel: songInfo.voiceChannel,
                    requestedBy: songInfo.requestedBy,

                    duration: {
                        hours: songInfo.duration.hours,
                        minutes: songInfo.duration.minutes,
                        seconds: songInfo.duration.seconds
                    }
                })

                resolve({ guildMap: serverQueue, songInfo: songObject });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for joining your bot in voice channel
     * @param {GuildMember} member Discord GuildMember
     * @returns {Promise<{ status: Boolean, voiceChannel: VoiceChannel }>} Returns the status and object of the voice channel
    */
    joinVoiceChannel(member) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!member.voice.channel) return reject(new MusicPlayerError());

                let usersCollection = member.voice.channel.members;
                if (usersCollection.get(this.client.user.id)) return reject(new MusicPlayerError(PlayerErrors.clientInVoiceChannel));

                await member.voice.channel.join();
                resolve({ status: true, voiceChannel: member.voice.channel });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for left your bot the voice channel
     * @param {GuildMember} member Discord GuildMember 
     * @returns {Promise<{ status: Boolean, voiceChannel: VoiceChannel }>} Returns the status and object of the voice channel
    */
    leaveVoiceChannel(member) {
        return new Promise(async (resolve, reject) => {
            try {
                if (!member.voice.channel) return reject(new MusicPlayerError(PlayerErrors.voiceChannelNotFound));

                let usersCollection = member.voice.channel.members.each(user => user.id === this.client.user.id);
                if (!usersCollection.get(this.client.user.id)) return reject(new MusicPlayerError(PlayerErrors.clientNotInVoiceChannel));

                await member.voice.channel.leave();
                resolve({ status: true, voiceChannel: member.voice.channel });
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Method for creating progress bar
     * @param {Guild} guild Discord Guild
     * @returns {Promise<{ bar: String, percents: String }>} Returns an object with the progress bar data
    */
    createProgressBar(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                if (!serverQueue.connection.dispatcher) return resolve({ bar: '🔘▬▬▬▬▬▬▬▬▬▬', percents: '0%' })

                const seconds = Math.floor((Number(serverQueue.songs[0].duration.hours) * 3600) + (Number(serverQueue.songs[0].duration.minutes) * 60) + Number(serverQueue.songs[0].duration.seconds));
                const total = Math.floor(seconds * 1000);
                const current = Math.floor(serverQueue.connection.dispatcher.streamTime || 0);
                const size = 11;
                const line = '▬';
                const slider = '🔘';

                if (!total) return resolve(`🔘▬▬▬▬▬▬▬▬▬▬  [0%]`);
                if (!current) return resolve(`🔘▬▬▬▬▬▬▬▬▬▬  [0%]`);
                if (isNaN(total)) return resolve(`🔘▬▬▬▬▬▬▬▬▬▬  [0%]`);
                if (isNaN(current)) return resolve(`🔘▬▬▬▬▬▬▬▬▬▬  [0%]`);
                if (isNaN(size)) return resolve(`🔘▬▬▬▬▬▬▬▬▬  [0%]`);
                if (current > total) {
                    const bar = line.repeat(size + 2);
                    const percentage = (current / total) * 100;
                    return [bar, percentage];
                } else {
                    const percentage = current / total;
                    const progress = Math.round((size * percentage));
                    const emptyProgress = size - progress;
                    const progressText = line.repeat(progress).replace(/.$/, slider);
                    const emptyProgressText = line.repeat(emptyProgress);
                    const bar = progressText + emptyProgressText;
                    const calculated = Math.floor(percentage * 100);
                    if (calculated < 5) {
                        resolve({ bar: '🔘▬▬▬▬▬▬▬▬▬▬', percents: `${calculated}%` });
                    } else {
                        resolve({ bar: bar, percents: `${calculated}%` });
                    }
                }
            } catch (error) {
                reject(error);
            }
        })
    }

    /**
     * Sets the filter for server queue songs
     * @param {Guild} guild Discord Guild
     * @param {String} filter Filter Name
     * @returns {Promise<{ status: Boolean, filter: String, queue: Array<Object>}>} Returns installation status, filter name and server queue array
    */
    setFilter(guild, filter) {
        return new Promise(async (resolve, reject) => {
            let serverQueue = await this.queue.get(guild.id);
            if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

            if (!filter) return reject(new MusicPlayerError(PlayerErrors.setFilter.filterNotFound));
            if (!isNaN(filter)) return reject(new MusicPlayerError(PlayerErrors.setFilter.invalidFilterType));

            let searchFilter = Filters.find(filters => filters.name === filter);
            if (!searchFilter) return reject(new MusicPlayerError(PlayerErrors.setFilter.invalidFilterName));

            serverQueue.filter = searchFilter.value

            this.play(guild, serverQueue.songs[0]);
            return resolve({ status: true, filter: filter, queue: serverQueue.songs });
        })
    }

    /**
     * Method for getting guild map
     * @param {Guild} guild Discord Guild 
     * @returns {Promise<Object>} Returns an object with server queue parameters
    */
    getGuildMap(guild) {
        return new Promise(async (resolve, reject) => {
            try {
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

                return resolve(serverQueue);
            } catch (err) {
                return reject(err);
            }
        })
    }

    /**
     * Method for getting all filters of a module
     * @returns {Promise<Array<Object>>} Returns an array of all filters in the module
    */
    getFilters() {
        return new Promise(async (resolve, reject) => {
            return resolve(Filters);
        })
    }

    /**
     * Method for getting the lyrics of the current song
     * @param {Guild} guild Discord Guild
     * @returns {Promise<{ song: String, lyrics: String }>} Returns an object with the name of the song and lyrics to it
    */
    getLyrics(guild) {
        return new Promise(async (resolve, reject) => {
            try{
                let serverQueue = await this.queue.get(guild.id);
                if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound)); 

                const lyrics = await searchLyrics(serverQueue.songs[0].title, '');
                if(!lyrics) return reject(new MusicPlayerError(PlayerErrors.getLyrics.lyricsNotFound.replace('{song}', serverQueue.songs[0].title)));

                return resolve({ song: serverQueue.songs[0].title, lyrics: lyrics });
            }catch(error){
                return reject(error);
            }
        })
    }

    /**
     * Method for shuffling songs in queue
     * @param {Guild} guild Discord Guild
     * @returns {Promise<Object>} Returns an object with server queue parameters
    */
    shuffle(guild) {
        return new Promise(async (resolve, reject) => {
            let serverQueue = await this.queue.get(guild.id);
            if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

            const currentSong = serverQueue.songs.shift();

            for(let i = serverQueue.songs.length - 1; i > 0; i--) {
                const index = Math.floor(Math.random() * (i + 1));
                [serverQueue.songs[i], serverQueue.songs[index]] = [serverQueue.songs[index], serverQueue.songs[i]];
            }

            serverQueue.songs.unshift(currentSong);

            return resolve(serverQueue);
        })
    }

    /**
     * Method for removing songs from the queue by ID/title
     * @param {Guild} guild Discord Guild
     * @param {String | Number} song_Name_ID Song Index or Name in queue
     * @returns {Promise<{ song: Object, songs: Number }>} Return removed song info and song count in queue
    */
    removeSong(guild, song_Name_ID) {
        return new Promise(async (resolve, reject) => {
            let serverQueue = await this.queue.get(guild.id);
            if (!serverQueue) return reject(new MusicPlayerError(PlayerErrors.queueNotFound));

            if(!isNaN(song_Name_ID)) {
                const songIndex = Math.floor(song_Name_ID - 1);
                const song = serverQueue.songs[songIndex];
                
                if(!song) return reject(new MusicPlayerError(PlayerErrors.removeSong.songNotFound.replace('{value}', song_Name_ID)));
                serverQueue.songs = serverQueue.songs.filter(track => track != song);

                return resolve({ song: song, songs: serverQueue.songs.length });
            }else{
                const songName = song_Name_ID;
                const song = serverQueue.songs.find(track => track.title === songName);
                
                if(!song) return reject(new MusicPlayerError(PlayerErrors.removeSong.songNotFound.replace('{value}', song_Name_ID)));
                serverQueue.songs = serverQueue.songs.filter(track => track != song);

                return resolve({ song: song, songs: serverQueue.songs.length });
            }
        })
    }

    /**
     * Method for initialization module
     * @returns {void}
     * @private
    */
    initPlayer() {
        this.ready = true;
    }
}

/**
 * Emits when the song starts playing
 * @event MusicPlayer#playingSong
 * @param {Object} data Callback
 * @param {TextChannel} data.textChannel Queue Text Channel
 * @param {VoiceChannel} data.voiceChannel Queue Voice Channel
 * @param {VoiceConnection} data.connection Queue Voice Connection
 * @param {Array<Object>} data.songs Queue Songs
 * @param {Number} data.volume Queue Songs Volume
 * @param {Boolean} data.loop Queue Song Loop
 * @param {Boolean} data.queueLoop Queue Song Queue Loop
 * @param {Boolean} data.playing Queue Song Playing Status
 * @param {String} data.filter Queue Songs Filter
 */

/**
 * Emits when a song is added to the queue
 * @event MusicPlayer#songAdded
 * @param {Object} song Callback
 * @param {Number} song.index Song Position in Queue
 * @param {String} song.searchType Search Type (URL or Name)
 * @param {String} song.title Song Title
 * @param {String} song.url Song URL
 * @param {String} song.thumbnail Song Thumbnail
 * @param {String} song.author Song Uploader
 * @param {TextChannel} song.textChannel Text Channel
 * @param {VoiceChannel} song.voiceChannel Voice Channel
 * @param {User} song.requestedBy Requester of the Song
 * @param {Object} song.duration Song Duration
 */

/**
 * Emits when the queue ends
 * @event MusicPlayer#queueEnded
 * @param {Object} data Callback
 * @param {TextChannel} data.textChannel Queue Text Channel
 * @param {VoiceChannel} data.voiceChannel Queue Voice Channel
 * @param {VoiceConnection} data.connection Queue Voice Connection
 * @param {Array<Object>} data.songs Queue Songs
 * @param {Number} data.volume Queue Songs Volume
 * @param {Boolean} data.loop Queue Song Loop
 * @param {Boolean} data.queueLoop Queue Song Queue Loop
 * @param {Boolean} data.playing Queue Song Playing Status
 * @param {String} data.filter Queue Songs Filter
 */

/**
 * Emits when an error occurs
 * @event MusicPlayer#playerError
 * @param {Object} data Callback
 * @param {TextChannel} data.textChannel Text Channel
 * @param {Message} data.message Message
 * @param {String} data.method Executed Method
 * @param {Error} data.error Returned Error
 */

module.exports = MusicPlayer;