// 2013, @muazkh - github.com/muaz-khan
// MIT License - https://webrtc-experiment.appspot.com/licence/
// Documentation - https://github.com/muaz-khan/WebRTC-Experiment/tree/master/DataChannel

(function() {

    // a middle-agent between public API and the Signaler object
    window.DataChannel = function(channel, extras) {
        var signaler, self = this;

        this.channel = channel || location.href.replace( /\/|:|#|%|\.|\[|\]/g , '');
        this.userid = getToken();

        if (channel) self.automatic = true;
        extras = extras || { };

        // on each new session
        this.onroom = function(room) {
            if (room.roomid != self.channel) return;

            if (self.detectedRoom) return;
            self.detectedRoom = true;

            self.join(room);
        };

        function initSignaler() {
            signaler = new Signaler(self);
        }

        // open new connection
        this.open = function(_channel) {
            self.detectedRoom = true;
            if (_channel) self.channel = _channel;

            !signaler && initSignaler();
            signaler.broadcast({
                roomid: self.channel
            });
        };

        // join pre-created data connection
        this.join = function(room) {
            !signaler && initSignaler();
            signaler.join({
                to: room.userid,
                roomid: room.roomid
            });
        };

        this.send = function(data, _channel) {
            if (!data) throw 'No file, data or text message to share.';
            if (data.size)
                FileSender.send({
                    file: data,
                    root: self,
                    channel: _channel,
                    userid: self.userid
                });
            else
                TextSender.send({
                    text: data,
                    root: self,
                    channel: _channel,
                    userid: self.userid
                });
        };

        this.connect = function(_channel) {
            if (_channel) self.channel = _channel;
            initSignaler();
        };

        for (var extra in extras) {
            self[extra] = extras[extra];
        }

        this.openNewSession = function(isOpenNewSession, isNonFirebaseClient) {
            if (isOpenNewSession) {
                if (self.isNewSessionOpened) return;
                self.isNewSessionOpened = true;

                if (!self.joinedARoom) self.open();
            }

            if (!isOpenNewSession || isNonFirebaseClient) self.connect();

            // for non-firebase clients
            if (isNonFirebaseClient)
                setTimeout(function() {
                    self.openNewSession(true);
                }, 5000);
        };

        function detectPresence() {
            if (window.Firebase) {
                console.debug('checking presence of the room..');
                new window.Firebase('https://' + (self.firebase || 'chat') + '.firebaseIO.com/' + self.channel).once('value', function(data) {
                    console.debug('room is present?', data.val() != null);
                    self.openNewSession(data.val() == null);
                });
            } else self.openNewSession(false, true);
        }

        if (self.automatic) setTimeout(detectPresence, 1000);

    };

    // it is a backbone object

    function Signaler(root) {
        // unique identifier for the current user
        var userid = root.userid || getToken();

        // self instance
        var signaler = this;

        // object to store all connected peers
        var peers = { };

        // object to store all connected participants's ids
        var participants = { };

        function onSocketMessage(data) {
            // don't get self-sent data
            if (data.userid == userid) return false;

            // if it is not a leaving alert
            if (!data.leaving) return signaler.onmessage(data);


            root.onleave
                && root.onleave({
                    userid: data.userid
                });

            if (data.broadcaster && data.forceClosingTheEntireSession) leave();

            // closing peer connection
            var peer = peers[data.userid];
            if (peer && peer.peer) {
                try {
                    peer.peer.close();
                } catch(e) {
                }
                delete peers[data.userid];
            }
        }

        // it is called when your signaling implementation fires "onmessage"
        this.onmessage = function(message) {
            // if new room detected
            if (message.roomid
                && message.broadcasting

                    // one user can participate in one room at a time
                    && !signaler.sentParticipationRequest) {

                // broadcaster's and participant's session must be identical
                root.onroom(message);

            } else
                // for pretty logging
                console.debug(JSON.stringify(message, function(key, value) {
                    if (value.sdp) {
                        console.log(value.sdp.type, '————', value.sdp.sdp);
                        return '';
                    } else return value;
                }, '————'));

            // if someone shared SDP
            if (message.sdp && message.to == userid)
                this.onsdp(message);

            // if someone shared ICE
            if (message.candidate && message.to == userid)
                this.onice(message);

            // if someone sent participation request
            if (message.participationRequest && message.to == userid) {
                participants[message.userid] = message.userid;
                participationRequest(message);
            }

            // session initiator transmitted new participant's details
            // it is useful for multi-users connectivity
            if (message.conferencing && message.newcomer != userid && !!participants[message.newcomer] == false) {
                participants[message.newcomer] = message.newcomer;
                signaler.signal({
                    participationRequest: true,
                    to: message.newcomer
                });
            }

            // if current user is suggested to play role of broadcaster
            // to keep active session all the time; event if session initiator leaves
            if (message.playRoleOfBroadcaster === userid)
                this.broadcast({
                    roomid: signaler.roomid
                });

            // broadcaster forced the user to leave his room!
            if (message.getOut && message.who == userid) leave();
        };

        function participationRequest(message) {
            // it is appeared that 10 or more users can send 
            // participation requests concurrently
            // onicecandidate fails in such case
            if (!signaler.creatingOffer) {
                signaler.creatingOffer = true;
                createOffer(message);
                setTimeout(function() {
                    signaler.creatingOffer = false;
                    if (signaler.participants &&
                        signaler.participants.length) repeatedlyCreateOffer();
                }, 5000);
            } else {
                if (!signaler.participants) signaler.participants = [];
                signaler.participants[signaler.participants.length] = message;
            }
        }

        // reusable function to create new offer

        function createOffer(message) {
            var _options = merge(options, {
                to: message.userid
            });
            peers[message.userid] = Offer.createOffer(_options);
        }

        // reusable function to create new offer repeatedly

        function repeatedlyCreateOffer() {
            console.log('signaler.participants', signaler.participants);
            var firstParticipant = signaler.participants[0];
            if (!firstParticipant) return;

            signaler.creatingOffer = true;
            createOffer(firstParticipant);

            // delete "firstParticipant" and swap array
            delete signaler.participants[0];
            signaler.participants = swap(signaler.participants);

            setTimeout(function() {
                signaler.creatingOffer = false;
                if (signaler.participants[0])
                    repeatedlyCreateOffer();
            }, 5000);
        }

        // if someone shared SDP
        this.onsdp = function(message) {
            var sdp = message.sdp;

            if (sdp.type == 'offer') {
                var _options = merge(options, {
                    to: message.userid,
                    sdp: sdp
                });
                peers[message.userid] = Answer.createAnswer(_options);
            }

            if (sdp.type == 'answer') {
                peers[message.userid].setRemoteDescription(sdp);
            }
        };

        // if someone shared ICE
        this.onice = function(message) {
            var peer = peers[message.userid];
            if (peer) peer.addIceCandidate(message.candidate);
        };

        // it is passed over Offer/Answer objects for reusability
        var options = {
            onsdp: function(e) {
                signaler.signal({
                    sdp: e.sdp,
                    to: e.userid
                });
            },
            onicecandidate: function(e) {
                signaler.signal({
                    candidate: e.candidate,
                    to: e.userid
                });
            },
            onopen: function(e) {
                if (!root.channels) root.channels = { };
                root.channels[e.userid] = {
                    send: function(message) {
                        root.send(message, this.channel);
                    },
                    channel: e.channel
                };
                if (root.onopen) root.onopen(e);

                forwardParticipant(e);
            },
            onmessage: function(e) {
                var message = e.data;
                if (!message.size)
                    message = JSON.parse(message);

                if (message.type == 'text')
                    textReceiver.receive({
                        data: message,
                        root: root,
                        userid: e.userid
                    });

                else if (message.size || message.type == 'file')
                    fileReceiver.receive({
                        data: message,
                        root: root,
                        userid: e.userid
                    });
                else if (root.onmessage)
                    root.onmessage(message, e.userid);
            },
            onclose: function(e) {
                if (root.onclose) root.onclose(e);

                var myChannels = root.channels,
                    closedChannel = e.currentTarget;

                for (var _userid in myChannels) {
                    if (closedChannel === myChannels[_userid].channel)
                        delete root.channels[_userid];
                }
            },
            onerror: function(e) {
                if (root.onerror) root.onerror(e);
            },
            bandwidth: root.bandwidth
        };

        function forwardParticipant(e) {
            // for multi-users connectivity
            // i.e. video-conferencing
            signaler.isbroadcaster &&
                signaler.signal({
                    conferencing: true,
                    newcomer: e.userid
                });
        }

        var textReceiver = new TextReceiver();
        var fileReceiver = new FileReceiver();

        // call only for session initiator
        this.broadcast = function(_config) {
            _config = _config || { };
            signaler.roomid = _config.roomid || getToken();
            signaler.isbroadcaster = true;
            (function transmit() {
                signaler.signal({
                    roomid: signaler.roomid,
                    broadcasting: true
                });

                !root.transmitRoomOnce
                    && !signaler.left
                        && setTimeout(transmit, root.interval || 3000);
            })();

            // if broadcaster leaves; clear all JSON files from Firebase servers
            if (socket.onDisconnect) socket.onDisconnect().remove();
        };

        // called for each new participant
        this.join = function(_config) {
            signaler.roomid = _config.roomid;
            this.signal({
                participationRequest: true,
                to: _config.to
            });
            signaler.sentParticipationRequest = true;
        };

        function leave() {
            if (socket.remove) socket.remove();

            signaler.signal({
                leaving: true,

                // is he session initiator?
                broadcaster: !!signaler.broadcaster,

                // is he willing to close the entire session
                forceClosingTheEntireSession: !!root.autoCloseEntireSession
            });

            // if broadcaster leaves; don't close the entire session
            if (signaler.isbroadcaster && !root.autoCloseEntireSession) {
                var gotFirstParticipant;
                for (var participant in participants) {
                    if (gotFirstParticipant) break;
                    gotFirstParticipant = true;
                    participants[participant] && signaler.signal({
                        playRoleOfBroadcaster: participants[participant]
                    });
                }
            }

            participants = { };

            // close all connected peers
            for (var peer in peers) {
                peer = peers[peer];
                if (peer.peer) peer.peer.close();
            }
            peers = { };

            signaler.left = true;

            // so, he can join other rooms without page reload
            root.detectedRoom = false;
        }

        // currently you can't eject any user
        // however, you can leave the entire session
        root.eject = root.leave = function(_userid) {
            if (!_userid) return leave();

            // broadcaster can throw any user out of the room
            signaler.broadcaster
                && signaler.signal({
                    getOut: true,
                    who: _userid
                });
        };

        // if someone closes the window or tab
        window.onbeforeunload = function() {
            leave();
            // return 'You left the session.';
        };

        // if someone press "F5" key to refresh the page
        window.onkeyup = function(e) {
            if (e.keyCode == 116)
                leave();
        };

        // if someone leaves by clicking a "_blank" link
        var anchors = document.querySelectorAll('a'),
            length = anchors.length;
        for (var i = 0; i < length; i++) {
            var a = anchors[i];
            if (a.href.indexOf('#') !== 0 && a.getAttribute('target') != '_blank')
                a.onclick = function() {
                    leave();
                };
        }

        // signaling implementation
        // if no custom signaling channel is provided; use Firebase
        if (!root.openSignalingChannel) {
            if (!window.Firebase) throw 'You must link <https://cdn.firebase.com/v0/firebase.js> file.';

            // Firebase is capable to store data in JSON format
            root.transmitRoomOnce = true;
            var socket = new window.Firebase('https://' + (root.firebase || 'chat') + '.firebaseIO.com/' + root.channel);
            socket.on('child_added', function(snap) {
                var data = snap.val();
                onSocketMessage(data);

                // we want socket.io behavior; 
                // that's why data is removed from firebase servers 
                // as soon as it is received
                snap.ref().remove();
            });

            // method to signal the data
            this.signal = function(data) {
                data.userid = userid;

                // "set" allow us overwrite old data
                // it is suggested to use "set" however preferred "push"!
                socket.push(data);
            };
        } else {
            // custom signaling implementations
            // e.g. WebSocket, Socket.io, SignalR, WebSync, HTTP-based POST/GET, Long-Polling etc.
            var socket = root.openSignalingChannel(function(message) {
                message = JSON.parse(message);
                onSocketMessage(message);
            });

            // method to signal the data
            this.signal = function(data) {
                data.userid = userid;
                socket.send(JSON.stringify(data));
            };
        }
    }

    // reusable stuff
    var RTCPeerConnection = window.mozRTCPeerConnection || window.webkitRTCPeerConnection;
    var RTCSessionDescription = window.mozRTCSessionDescription || window.RTCSessionDescription;
    var RTCIceCandidate = window.mozRTCIceCandidate || window.RTCIceCandidate;

    navigator.getUserMedia = navigator.mozGetUserMedia || navigator.webkitGetUserMedia;
    window.URL = window.webkitURL || window.URL;

    var isFirefox = !!navigator.mozGetUserMedia;
    var isChrome = !!navigator.webkitGetUserMedia;

    var STUN = {
        url: isChrome ? 'stun:stun.l.google.com:19302' : 'stun:23.21.150.121'
    };

    // old TURN syntax
    var TURN = {
        url: 'turn:webrtc%40live.com@numb.viagenie.ca',
        credential: 'muazkh'
    };

    var iceServers = {
        iceServers: [STUN]
    };

    if (isChrome) {
        // in chrome M29 and higher
        if (parseInt(navigator.userAgent.match( /Chrom(e|ium)\/([0-9]+)\./ )[2]) >= 28)
            TURN = {
                url: 'turn:numb.viagenie.ca',
                credential: 'muazkh',
                username: 'webrtc@live.com'
            };

        // No STUN to make sure it works all the time!
        iceServers.iceServers = [TURN];
    }

    var optionalArgument = {
        optional: [{
            RtpDataChannels: true
        }]
    };

    var offerAnswerConstraints = {
        optional: [],
        mandatory: {
            OfferToReceiveAudio: isFirefox,
            OfferToReceiveVideo: isFirefox
        }
    };

    function getToken() {
        return Math.round(Math.random() * 60535) + 5000;
    }

    function setBandwidth(sdp, bandwidth) {
        bandwidth = bandwidth || { };

        // remove existing bandwidth lines
        sdp = sdp.replace( /b=AS([^\r\n]+\r\n)/g , '');

        sdp = sdp.replace( /a=mid:audio\r\n/g , 'a=mid:audio\r\nb=AS:' + (bandwidth.audio || 50) + '\r\n');
        sdp = sdp.replace( /a=mid:video\r\n/g , 'a=mid:video\r\nb=AS:' + (bandwidth.video || 256) + '\r\n');
        sdp = sdp.replace( /a=mid:data\r\n/g , 'a=mid:data\r\nb=AS:' + (bandwidth.data || 1638400) + '\r\n');

        return sdp;
    }

    function setBitrate(sdp/*, bitrate*/) {
        // sdp = sdp.replace( /a=mid:video\r\n/g , 'a=mid:video\r\na=rtpmap:120 VP8/90000\r\na=fmtp:120 x-google-min-bitrate=' + (bitrate || 10) + '\r\n');
        return sdp;
    }

    function setFramerate(sdp, framerate) {
        framerate = framerate || { };
        sdp = sdp.replace('a=fmtp:111 minptime=10', 'a=fmtp:111 minptime=' + (framerate.minptime || 10));
        sdp = sdp.replace('a=maxptime:60', 'a=maxptime:' + (framerate.maxptime || 60));
        return sdp;
    }

    function serializeSdp(sessionDescription, config) {
        if (isFirefox) return sessionDescription;

        var sdp = sessionDescription.sdp;
        sdp = setBandwidth(sdp, config.bandwidth);
        sdp = setFramerate(sdp, config.framerate);
        sdp = setBitrate(sdp, config.bitrate);
        sessionDescription.sdp = sdp;
        return sessionDescription;
    }

    // var offer = Offer.createOffer(config);
    // offer.setRemoteDescription(sdp);
    // offer.addIceCandidate(candidate);
    var Offer = {
        createOffer: function(config) {
            var peer = new RTCPeerConnection(iceServers, optionalArgument);

            RTCDataChannel.createDataChannel(peer, config);

            function sdpCallback() {
                if (!config.onsdp) return;

                config.onsdp({
                    sdp: peer.localDescription,
                    userid: config.to
                });
            }

            if (config.onicecandidate)
                peer.onicecandidate = function(event) {
                    if (!event.candidate) sdpCallback();
                };

            peer.ongatheringchange = function(event) {
                if (event.currentTarget && event.currentTarget.iceGatheringState === 'complete')
                    sdpCallback();
            };

            if (isChrome) {
                peer.createOffer(function(sdp) {
                    sdp = serializeSdp(sdp, config);
                    peer.setLocalDescription(sdp);
                }, null, offerAnswerConstraints);

            } else if (isFirefox) {
                navigator.mozGetUserMedia({
                        audio: true,
                        fake: true
                    }, function(stream) {
                        peer.addStream(stream);
                        peer.createOffer(function(sdp) {
                            peer.setLocalDescription(sdp);
                            if (config.onsdp)
                                config.onsdp({
                                    sdp: sdp,
                                    userid: config.to
                                });
                        }, null, offerAnswerConstraints);

                    }, mediaError);
            }

            this.peer = peer;

            return this;
        },
        setRemoteDescription: function(sdp) {
            this.peer.setRemoteDescription(new RTCSessionDescription(sdp));
        },
        addIceCandidate: function(candidate) {
            this.peer.addIceCandidate(new RTCIceCandidate({
                sdpMLineIndex: candidate.sdpMLineIndex,
                candidate: candidate.candidate
            }));
        }
    };

    // var answer = Answer.createAnswer(config);
    // answer.setRemoteDescription(sdp);
    // answer.addIceCandidate(candidate);
    var Answer = {
        createAnswer: function(config) {
            var peer = new RTCPeerConnection(iceServers, optionalArgument), channel;

            if (isChrome)
                RTCDataChannel.createDataChannel(peer, config);
            else if (isFirefox) {
                peer.ondatachannel = function(event) {
                    channel = event.channel;
                    channel.binaryType = 'blob';
                    RTCDataChannel.setChannelEvents(channel, config);
                };

                navigator.mozGetUserMedia({
                        audio: true,
                        fake: true
                    }, function(stream) {

                        peer.addStream(stream);
                        peer.setRemoteDescription(new RTCSessionDescription(config.sdp));
                        peer.createAnswer(function(sdp) {
                            peer.setLocalDescription(sdp);
                            if (config.onsdp)
                                config.onsdp({
                                    sdp: sdp,
                                    userid: config.to
                                });
                        }, null, offerAnswerConstraints);

                    }, mediaError);
            }

            if (config.onicecandidate)
                peer.onicecandidate = function(event) {
                    if (event.candidate)
                        config.onicecandidate({
                            candidate: event.candidate,
                            userid: config.to
                        });
                };

            if (isChrome) {
                peer.setRemoteDescription(new RTCSessionDescription(config.sdp));
                peer.createAnswer(function(sdp) {
                    sdp = serializeSdp(sdp, config);

                    peer.setLocalDescription(sdp);
                    if (config.onsdp)
                        config.onsdp({
                            sdp: sdp,
                            userid: config.to
                        });
                }, null, offerAnswerConstraints);
            }

            this.peer = peer;

            return this;
        },
        addIceCandidate: function(candidate) {
            this.peer.addIceCandidate(new RTCIceCandidate({
                sdpMLineIndex: candidate.sdpMLineIndex,
                candidate: candidate.candidate
            }));
        }
    };

    // RTCDataChannel.createDataChannel(peer, config);
    // RTCDataChannel.setChannelEvents(channel, config);
    var RTCDataChannel = {
        createDataChannel: function(peer, config) {
            var channel = peer.createDataChannel('channel', { reliable: false });
            this.setChannelEvents(channel, config);
        },
        setChannelEvents: function(channel, config) {
            channel.onopen = function() {
                config.onopen({
                    channel: channel,
                    userid: config.to
                });
            };

            channel.onmessage = function(e) {
                config.onmessage({
                    data: e.data,
                    userid: config.to
                });
            };

            channel.onclose = function(event) {
                config.onclose({
                    event: event,
                    userid: config.to
                });
            };

            channel.onerror = function(event) {
                config.onerror({
                    event: event,
                    userid: config.to
                });
            };
        }
    };

    // FileSaver.SaveToDisk(object);
    var FileSaver = {
        SaveToDisk: function(e) {
            var save = document.createElement('a');
            save.href = e.fileURL;
            save.target = '_blank';
            save.download = e.fileName || e.fileURL;

            var evt = document.createEvent('MouseEvents');
            evt.initMouseEvent('click', true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);

            save.dispatchEvent(evt);
            (window.URL || window.webkitURL).revokeObjectURL(save.href);
        }
    };

    // FileSender.send(config);
    var FileSender = {
        send: function(config) {
            var root = config.root;
            var file = config.file;

            function send(message) {
                if (isChrome) message = JSON.stringify(message);

                // share data between two unique users i.e. direct messages
                if (config.channel) return config.channel.send(message);

                // share data with all connected users
                var channels = root.channels || { };
                for (var channel in channels) {
                    channels[channel].channel.send(message);
                }
            }

            if (isFirefox) {
                send(JSON.stringify({
                    fileName: file.name,
                    type: 'file'
                }));
                send(file);
                if (root.onFileSent)
                    root.onFileSent({
                        file: file,
                        userid: config.userid
                    });
            }

            if (isChrome) {
                var reader = new window.FileReader();
                reader.readAsDataURL(file);
                reader.onload = onReadAsDataURL;
            }

            var packetSize = 1000,
                textToTransfer = '',
                numberOfPackets = 0,
                packets = 0;

            function onReadAsDataURL(event, text) {
                var data = {
                    type: 'file'
                };

                if (event) {
                    text = event.target.result;
                    numberOfPackets = packets = data.packets = parseInt(text.length / packetSize);
                }

                if (root.onFileProgress)
                    root.onFileProgress({
                        remaining: packets--,
                        length: numberOfPackets,
                        sent: numberOfPackets - packets,
                        userid: config.userid
                    });

                if (text.length > packetSize)
                    data.message = text.slice(0, packetSize);
                else {
                    data.message = text;
                    data.last = true;
                    data.name = file.name;

                    if (root.onFileSent)
                        root.onFileSent({
                            file: file,
                            userid: config.userid
                        });
                }

                send(data);

                textToTransfer = text.slice(data.message.length);

                if (textToTransfer.length)
                    setTimeout(function() {
                        onReadAsDataURL(null, textToTransfer);
                    }, 500);
            }
        }
    };

    // new FileReceiver().receive(config);

    function FileReceiver() {
        var content = [],
            fileName = '',
            packets = 0,
            numberOfPackets = 0;

        this.receive = function(config) {
            var root = config.root;
            var data = config.data;

            if (isFirefox) {
                if (data.fileName)
                    fileName = data.fileName;

                if (data.size) {
                    var reader = new window.FileReader();
                    reader.readAsDataURL(data);
                    reader.onload = function(event) {
                        FileSaver.SaveToDisk({
                            fileURL: event.target.result,
                            fileName: fileName
                        });

                        if (root.onFileReceived)
                            root.onFileReceived({
                                fileName: fileName,
                                userid: config.userid
                            });
                    };
                }
            }

            if (isChrome) {
                if (data.packets)
                    numberOfPackets = packets = parseInt(data.packets);

                if (root.onFileProgress)
                    root.onFileProgress({
                        remaining: packets--,
                        length: numberOfPackets,
                        received: numberOfPackets - packets,
                        userid: config.userid
                    });

                content.push(data.message);

                if (data.last) {
                    FileSaver.SaveToDisk({
                        fileURL: content.join(''),
                        fileName: data.name
                    });

                    if (root.onFileReceived)
                        root.onFileReceived({
                            fileName: data.name,
                            userid: config.userid
                        });
                    content = [];
                }
            }
        };
    }

    // TextSender.send(config);
    var TextSender = {
        send: function(config) {
            var root = config.root;

            function send(message) {
                message = JSON.stringify(message);

                // share data between two unique users i.e. direct messages
                if (config.channel) return config.channel.send(message);

                // share data with all connected users
                var channels = root.channels || { };
                for (var channel in channels) {
                    channels[channel].channel.send(message);
                }
            }


            var initialText = config.text,
                packetSize = 1000,
                textToTransfer = '';

            if (typeof initialText !== 'string')
                initialText = JSON.stringify(initialText);

            if (isFirefox || initialText.length <= packetSize)
                send(config.text);
            else
                sendText(initialText);

            function sendText(textMessage, text) {
                var data = {
                    type: 'text'
                };

                if (textMessage) {
                    text = textMessage;
                    data.packets = parseInt(text.length / packetSize);
                }

                if (text.length > packetSize)
                    data.message = text.slice(0, packetSize);
                else {
                    data.message = text;
                    data.last = true;
                }

                send(data);

                textToTransfer = text.slice(data.message.length);

                if (textToTransfer.length)
                    setTimeout(function() {
                        sendText(null, textToTransfer);
                    }, 500);
            }
        }
    };

    // new TextReceiver().receive(config);

    function TextReceiver() {
        var content = [];

        function receive(config) {
            var root = config.root;
            var data = config.data;

            content.push(data.message);
            if (data.last) {
                if (root.onmessage)
                    root.onmessage({
                        data: content.join(''),
                        userid: config.userid
                    });
                content = [];
            }
        }

        return {
            receive: receive
        };
    }

    // swap arrays

    function swap(arr) {
        var swapped = [],
            length = arr.length;
        for (var i = 0; i < length; i++)
            if (arr[i] && arr[i] !== true)
                swapped[swapped.length] = arr[i];
        return swapped;
    }

    function merge(mergein, mergeto) {
        for (var item in mergeto) {
            mergein[item] = mergeto[item];
        }
        return mergein;
    }

    function mediaError() {
        throw 'Unable to get access to fake audio.';
    }
})();
