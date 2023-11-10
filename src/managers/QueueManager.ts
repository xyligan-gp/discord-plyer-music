// Import manager requirements
import { AudioPlayer, AudioResource, VoiceConnection } from "@discordjs/voice";

// Import utils
import { RestOrArray, normalizeArray } from "../util/normalizeArray.function";

// Import manager interfaces
import { GuildQueue, GuildQueueChannel, GuildQueuePlayback, GuildQueueTrack, SetChannelType } from "../../types/managers/QueueManager";

/**
 * Player Queue Manager
 * 
 * @class
 * @classdesc Class representing a Queue Manager.
 * 
 * @implements {GuildQueue}
 */
class QueueManager implements GuildQueue {
    public startTimestamp: number;
    public endTimestamp: number;

    public repeat: RepeatMode;
    public channel: GuildQueueChannel;
    public playback: GuildQueuePlayback;

    public dispatcher: AudioPlayer;
    public connection: VoiceConnection;

    public tracks: GuildQueueTrack[];

    private _resource: AudioResource;

    /**
     * Creates a new instance of the Player Queue.
     */
    constructor() {
        /**
         * The start timestamp of the queue.
         *
         * @type {number|null}
         */
        this.startTimestamp = null;

        /**
         * The end timestamp of the queue.
         *
         * @type {number|null}
         */
        this.endTimestamp = null;

        /**
         * The repeat settings of the guild queue.
         *
         * @type {RepeatMode}
         */
        this.repeat = null;

        /**
         * The guild channels of the queue.
         *
         * @type {GuildQueueChannel}
         */
        this.channel = {
            text: null,
            voice: null
        }

        /**
         * The playback settings of the guild queue.
         *
         * @type {GuildQueuePlayback}
         */
        this.playback = {
            state: null,
            filter: null,
            volume: 5
        }

        /**
         * The AudioPlayer instance associated with the guild queue.
         *
         * @type {AudioPlayer}
         */
        this.dispatcher = null;

        /**
         * The VoiceConnection instance associated with the guild queue.
         *
         * @type {VoiceConnection}
         */
        this.connection = null;

        /**
         * The tracks in the guild queue.
         *
         * @type {GuildQueueTrack[]}
         */
        this.tracks = [];

        /**
         * AudioPlayer Resource
         * 
         * @type {AudioResource}
         * @private
         */
        this._resource = null;
    }

    /**
     * Checks if the queue is empty.
     *
     * @type {boolean} True if the queue is empty, false otherwise.
     */
    public get isEmpty(): boolean {
        return !this.tracks?.length;
    }

    /**
     * Checks if the player is startable.
     *
     * @type {boolean} True if the player is startable (dispatcher exists), otherwise false.
     */
    public get isStartable(): boolean {
        return this.dispatcher != null;
    }

    /**
     * Retrieves the currently playing track from the queue.
     *
     * @type {GuildQueueTrack|null} The currently playing track or null if there is no track.
     */
    public get nowPlaying(): GuildQueueTrack {
        return this.tracks[0] || null;
    }

    /**
     * Sets the timestamp value for the specified type in the QueueManager.
     * 
     * @param {TimestampType} type - The type of timestamp.
     * @param {number} [value] - The timestamp value to set. If not provided, the current timestamp will be used.
     * 
     * @returns {QueueManager} The QueueManager instance.
     */
    public setTimestamp(type: TimestampType, value?: number): this {
        this[`${type}Timestamp`] = value ? new Date(value).getTime() : Date.now();

        return this;
    }

    /**
     * Sets the repeat mode for the QueueManager.
     * 
     * @param {RepeatMode} [type=RepeatMode.DISABLED] - The repeat mode to set.
     * 
     * @returns {QueueManager} The QueueManager instance.
     */
    public setRepeatMode(type: RepeatMode = RepeatMode.DISABLED): this {
        this.repeat = type;

        return this;
    }

    /**
     * Sets the channel for the specified channel type in the QueueManager.
     * 
     * @param {ChannelType} type - The channel type.
     * @param {(PlayerTextChannel|PlayerVoiceChannel)} channel - The channel to set.
     * 
     * @returns {QueueManager} The QueueManager instance.
     */
    public setChannel<TChannelType extends ChannelType>(
        type: TChannelType,
        channel: SetChannelType<TChannelType>
    ): this {
        this.channel[type as string] = channel;

        return this;
    }

    /**
     * Set the volume of the playback.
     *
     * @param {number} value - The volume level to set (0 to 100).
     * 
     * @returns {QueueManager} The updated QueueManager instance.
     */
    public setVolume(value: number): this {
        this.playback.volume = value;
        this._resource?.volume?.setVolume(Math.floor(value / 100));
        
        return this;
    }

    /**
     * Adds tracks to the guild queue.
     *
     * @param {RestOrArray<GuildQueueTrack>} tracks - The tracks to add. Accepts both array and variadic arguments.
     * 
     * @returns {QueueManager} The updated QueueManager instance.
     */
    public addTracks(...tracks: RestOrArray<GuildQueueTrack>): this {
        const normalizedTracks = normalizeArray(tracks);

        if(this.tracks.length) this.tracks.push(...normalizedTracks);
        else this.tracks = normalizedTracks;

        return this;
    }

    /**
     * Creates a QueueManager instance from the provided GuildQueue data.
     *
     * @static
     * 
     * @param {GuildQueue} data - The GuildQueue data.
     * 
     * @returns {QueueManager} The created QueueManager instance.
     */
    public static from(data: GuildQueue): QueueManager {
        const queue = new QueueManager();

        if(data.endTimestamp) queue.setTimestamp(TimestampType.END, data.endTimestamp);
        if(data.startTimestamp) queue.setTimestamp(TimestampType.START, data.startTimestamp);

        queue.setRepeatMode(data.repeat)
        queue.setChannel(ChannelType.TEXT, data.channel.text)
        queue.setChannel(ChannelType.VOICE, data.channel.voice);
        queue.setVolume(data.playback.volume);

        queue.playback = data.playback;
        queue.dispatcher = data.dispatcher;
        queue.connection = data.connection;

        queue.addTracks(data.tracks);
        
        return queue;
    }

    /**
     * Converts the QueueManager instance to a plain object representation.
     *
     * @returns {GuildQueue} The GuildQueue object representation of the QueueManager.
     */
    public toJSON(): GuildQueue {
        return {
            startTimestamp: this.startTimestamp,
            endTimestamp: this.endTimestamp,

            repeat: this.repeat,
            channel: this.channel,
            playback: this.playback,

            dispatcher: this.dispatcher,
            connection: this.connection,

            tracks: this.tracks
        }
    }
}

/**
 * Enum representing the repeat mode types.
 *
 * @typedef {object} RepeatMode
 * 
 * @prop {string} DISABLED Repeat mode for disabling repeat.
 * @prop {string} TRACK Repeat mode for repeating the current track.
 * @prop {string} QUEUE Repeat mode for repeating the entire queue.
 */
enum RepeatMode {
    DISABLED = "disabled",
    TRACK = "track",
    QUEUE = "queue"
}

/**
 * Enum representing the channel types.
 *
 * @typedef {object} ChannelType
 * 
 * @prop {string} TEXT Channel type for text channels.
 * @prop {string} VOICE Channel type for voice channels.
 */
enum ChannelType {
    TEXT = "text",
    VOICE = "voice"
}

/**
 * Enum representing the timestamp types.
 *
 * @typedef {object} TimestampType
 * 
 * @prop {string} END Timestamp type for the end timestamp.
 * @prop {string} START Timestamp type for the start timestamp.
 */
enum TimestampType {
    END = "end",
    START = "start"
}

export {
    QueueManager,

    RepeatMode,
    ChannelType,
    TimestampType
}