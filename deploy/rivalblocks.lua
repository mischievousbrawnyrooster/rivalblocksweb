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
-- A game is recognised two ways, and either one alone is enough:
--
--   1. By name. Each client announces a WebSocket subprotocol in its handshake
--      (the `new WebSocket(url, '<name>.v1')` calls in src/pages), and
--      Wireshark keys its `ws.protocol` table on that negotiated string. This
--      one needs the handshake in the capture: the name is stated once, in the
--      Sec-WebSocket-Protocol header exchange, and never repeated. It also
--      needs a client new enough to send it.
--
--   2. By port, through a heuristic. Each match server owns one, so a frame on
--      8081..8085 that looks like our JSON is claimed with no handshake and no
--      client support at all. This is what reads captures taken before any of
--      this existed.
--
-- Which means a capture missing the handshake, or taken against an older
-- build, still comes out named -- as long as it was taken where the port is
-- the real one. Behind nginx every game shares port 80, so capture the
-- loopback hop between the proxy and the match server, not the public one.
--
-- Frames are readable because the protocol is deliberately plain ws:// with
-- perMessageDeflate off. See the deployment section of CLAUDE.md.

-- `ports` drives the heuristic at the bottom, which is what names a capture the
-- subprotocol cannot: one recorded before the clients announced a name, or one
-- that missed the handshake.
local games = {
  { key = 'blockout.v1',   id = 'blockout',   title = 'Blockout Royale',    col = 'BLOCKOUT',   ports = { 8081 } },
  { key = 'fracture.v1',   id = 'fracture',   title = 'Fracture Line',      col = 'FRACTURE',   ports = { 8082 } },
  { key = 'blastworks.v1', id = 'blastworks', title = 'Blastworks',         col = 'BLASTWORKS', ports = { 8083, 8084 } },
  { key = 'blockout3d.v1', id = 'blockout3d', title = 'Blockout Royale 3D', col = 'BLOCKOUT3D', ports = { 8085 } },
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

  -- The `ws.port` table looks like the obvious fallback here and is not one:
  -- these are text frames, and Wireshark routes text by the
  -- websocket.text_type preference rather than by port. Registering against
  -- ws.port was measured doing nothing at all. Heuristics *are* consulted for
  -- text, so that is what carries a capture with no subprotocol in it.
  local ours = {}
  for _, port in ipairs(game.ports) do ours[port] = true end

  proto:register_heuristic('ws', function(buf, pinfo, tree)
    if not (ours[pinfo.src_port] or ours[pinfo.dst_port]) then return false end
    local len = buf:len()
    if len < 6 then return false end
    local ok, head = pcall(function() return buf(0, math.min(len, 24)):string() end)
    if not ok or not head or not head:match('^%s*{%s*"t"%s*:') then return false end
    proto.dissector(buf, pinfo, tree)
    return true
  end)
end

for _, game in ipairs(games) do build(game) end
