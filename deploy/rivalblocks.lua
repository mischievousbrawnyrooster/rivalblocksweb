-- Wireshark dissector for the RivalBlocks game protocols.
--
-- Without this, a capture of any of the four games shows a column of
-- undifferentiated "WebSocket" rows and you read the JSON by eye. With it the
-- Protocol column names the game and every message field becomes a display
-- filter, so a class can ask "show me every shot fired" and get an answer.
--
-- Install (Windows):   copy to %APPDATA%\Wireshark\plugins\
--         (Linux/mac): copy to ~/.local/lib/wireshark/plugins/
-- Then Analyze > Reload Lua Plugins, or just restart Wireshark.
-- One-off, no install:  tshark -X lua_script:deploy/rivalblocks.lua -i <if>
--
-- This hangs off the WebSocket subprotocol each client announces in its
-- handshake (see the `new WebSocket(url, '<name>.v1')` calls in src/pages).
-- Wireshark keys its `ws.protocol` dissector table on that negotiated string,
-- which has one consequence worth knowing before you blame the plugin:
--
--   THE CAPTURE MUST INCLUDE THE HTTP HANDSHAKE.
--
-- The subprotocol is only ever stated once, in the Sec-WebSocket-Protocol
-- header exchange. Start the capture before the browser connects. Attach to a
-- session already in progress and Wireshark never learns the name, so the rows
-- stay labelled WebSocket and none of the filters below match anything.
--
-- Frames are readable because the protocol is deliberately plain ws:// with
-- perMessageDeflate off. See the deployment section of CLAUDE.md.

local games = {
  { key = 'blockout.v1',   id = 'blockout',   title = 'Blockout Royale',    col = 'BLOCKOUT' },
  { key = 'fracture.v1',   id = 'fracture',   title = 'Fracture Line',      col = 'FRACTURE' },
  { key = 'blastworks.v1', id = 'blastworks', title = 'Blastworks',         col = 'BLASTWORKS' },
  { key = 'blockout3d.v1', id = 'blockout3d', title = 'Blockout Royale 3D', col = 'BLOCKOUT3D' },
}

-- Every field is declared for every game rather than only the ones that game
-- sends. A filter written against one game then works against the others, and
-- an unused field simply never populates.
local specs = {
  { 'msgtype', 'Message type',   'string' },
  { 'name',    'Player name',    'string' },
  { 'dir',     'Direction',      'string' },
  { 'dx',      'Intent X',       'string' },
  { 'dy',      'Intent Y',       'string' },
  { 'aim',     'Aim angle',      'string' },
  { 'fire',    'Firing',         'string' },
  { 'bytes',   'Payload bytes',  'uint32' },
  { 'json',    'Raw JSON',       'string' },
}

-- What a client can say, per game. Anything outside this set is flagged rather
-- than shown as ordinary traffic: it is either an admin frame, a snapshot
-- coming the other way, or something that should not be on the wire at all.
local inputs = {
  blockout   = { join=1, move=1, use=1, ready=1 },
  fracture   = { join=1, input=1, use=1, dash=1, build=1, ready=1 },
  blastworks = { join=1, input=1, bomb=1, action=1, detonate=1, ready=1 },
  blockout3d = { join=1, input=1, jump=1, use=1, ready=1, click=1 },
}

local admin = { admin=1, kick=1, restart=1, botsonly=1, bots=1, arena=1 }

-- Replies, so that a frame coming the other way is labelled as one rather than
-- reported as an input nobody handles. `admin` is deliberately absent: it is
-- both a request and its own acknowledgement, and the direction is already in
-- the port columns.
local replies = { welcome=1, full=1 }

-- Deliberately not a JSON parser. These messages are flat objects written by
-- one client we control, so a match per key is enough and cannot loop, recurse
-- or blow up on a hostile payload the way a hand-rolled parser would.
local function scrape(text, key)
  return text:match('"' .. key .. '":%s*"([^"]*)"')
      or text:match('"' .. key .. '":%s*(%-?[%d%.]+)')
      or text:match('"' .. key .. '":%s*(%a+)')
      or text:match('"' .. key .. '":%s*(%[[^%]]*%])')
end

local function build(game)
  local proto = Proto(game.id, game.title .. ' (RivalBlocks)')
  local f = {}
  for _, s in ipairs(specs) do
    local abbrev = game.id .. '.' .. s[1]
    f[s[1]] = s[3] == 'uint32' and ProtoField.uint32(abbrev, s[2])
                                or ProtoField.string(abbrev, s[2])
  end
  local order = {}
  for _, s in ipairs(specs) do order[#order + 1] = f[s[1]] end
  proto.fields = order

  function proto.dissector(buf, pinfo, tree)
    local len = buf:len()
    if len == 0 then return 0 end

    -- A capture can hand us a partial or binary frame. Losing one row beats
    -- throwing an error into every packet.
    local ok, text = pcall(function() return buf(0, len):string() end)
    if not ok or not text then return 0 end

    pinfo.cols.protocol = game.col
    local sub = tree:add(proto, buf(), game.title)
    sub:add(f.bytes, buf(0, 0), len)

    local t = scrape(text, 't')
    if not t then
      pinfo.cols.info = 'malformed (' .. len .. ' bytes)'
      sub:add(f.json, buf(0, math.min(len, 240)))
      return len
    end
    sub:add(f.msgtype, buf(0, 0), t)

    -- Snapshots are the bulk of the bytes and none of the intent. Summarise
    -- them so the input messages stay findable by eye in the packet list.
    if t == 'state' then
      pinfo.cols.info = 'state snapshot (' .. len .. ' bytes)'
      return len
    end

    local bits = {}
    for _, key in ipairs({ 'name', 'dir', 'dx', 'dy', 'aim', 'fire' }) do
      local v = scrape(text, key)
      if v then
        sub:add(f[key], buf(0, 0), v)
        bits[#bits + 1] = key .. '=' .. v
      end
    end
    sub:add(f.json, buf(0, math.min(len, 240)))

    local label = t
    if replies[t] then
      label = t .. ' [server]'
    elseif admin[t] then
      label = t .. ' [admin]'
    elseif not inputs[game.id][t] then
      label = t .. ' [unknown]'
    end
    pinfo.cols.info = label .. (#bits > 0 and ('  ' .. table.concat(bits, ' ')) or '')
    return len
  end

  DissectorTable.get('ws.protocol'):add(game.key, proto)
end

for _, game in ipairs(games) do build(game) end
