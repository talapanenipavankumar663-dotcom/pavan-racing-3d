import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import './App.css'

const PLAYER_NAME = 'PAVAN KUMAR'
const MAX_SPEED = 200
const STORAGE_KEYS = {
  bestScore: 'pavan-best-score',
  totalCoins: 'pavan-total-coins',
  sound: 'pavan-sound-enabled',
}
const LEVEL_NAMES = [
  'CITY HIGHWAY',
  'EXPRESSWAY',
  'NIGHT HIGHWAY',
  'MOUNTAIN ROAD',
  'DESERT HIGHWAY',
  'RAINY HIGHWAY',
  'HIGH SPEED EXPRESSWAY',
]
const WEATHER_THEMES = [
  { sky: '#7ec8ff', fog: '#dfefff', ambient: '#dfefff', sun: '#ffd76b' },
  { sky: '#152236', fog: '#1a2942', ambient: '#8ba5d9', sun: '#7dd3fc' },
  { sky: '#7a8aa5', fog: '#c1cedb', ambient: '#b7c6d7', sun: '#dfe8ff' },
]
const LANE_X = [-3.5, 0, 3.5]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function lerp(start, end, alpha) {
  return start + (end - start) * alpha
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function getStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key)
    return value === null ? fallback : JSON.parse(value)
  } catch (error) {
    return fallback
  }
}

function setStoredValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (error) {
    // Ignore storage issues in restricted environments.
  }
}

function createRoadSegments() {
  return Array.from({ length: 10 }, (_, index) => ({
    id: index,
    z: index * 28,
  }))
}

function createTrafficVehicle(id, seed = 0) {
  const lane = LANE_X[Math.floor(Math.random() * LANE_X.length)]
  return {
    id,
    x: lane,
    z: 35 + seed * 28 + Math.random() * 18,
    lane,
    color: `hsl(${Math.random() * 200 + 20}, 65%, ${50 + Math.random() * 20}%)`,
    speed: randomBetween(28, 84),
    width: randomBetween(1.1, 1.9),
    length: randomBetween(2.4, 4.2),
    height: randomBetween(1, 1.8),
    passed: false,
    nearMissed: false,
    hit: false,
    drift: randomBetween(-0.2, 0.2),
  }
}

function createCoin(id, positionZ, laneIndex) {
  return {
    id,
    x: LANE_X[laneIndex % LANE_X.length],
    z: positionZ,
    y: 1.4,
    spin: Math.random() * 6.28,
    collected: false,
  }
}

function buildCoinLine(startZ, laneSequence) {
  return laneSequence.map((laneIndex, index) =>
    createCoin(`${startZ}-${laneIndex}-${index}`, startZ + index * 7, laneIndex),
  )
}

function buildWorld() {
  const traffic = Array.from({ length: 6 }, (_, index) => createTrafficVehicle(index + 1, index))
  const coins = [
    ...buildCoinLine(18, [0, 2, 1, 0, 2]),
    ...buildCoinLine(60, [2, 1, 0, 2, 1]),
    ...buildCoinLine(110, [0, 1, 2, 0, 1]),
  ]

  return {
    player: {
      x: 0,
      targetX: 0,
      speed: 0,
      maxSpeed: 0,
      health: 100,
      score: 0,
      coins: 0,
      accidents: 0,
      distance: 0,
      level: 1,
      lean: 0,
      brakeLights: false,
    },
    bestScore: getStoredValue(STORAGE_KEYS.bestScore, 0),
    totalCoins: getStoredValue(STORAGE_KEYS.totalCoins, 0),
    soundEnabled: getStoredValue(STORAGE_KEYS.sound, true),
    traffic,
    coins,
    roadSegments: createRoadSegments(),
    floatingTexts: [],
    particles: [],
    nextTrafficId: 7,
    nextCoinId: 100,
    lastNearMissId: null,
    lastCollisionAt: 0,
    winBanner: null,
    levelRequirement: 1400,
    nextLevel: 1,
    distanceTarget: 1400,
  }
}

function createAudioManager(soundEnabled) {
  let context = null
  let enabled = soundEnabled

  const ensureContext = () => {
    if (typeof window === 'undefined') {
      return null
    }

    const AudioCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioCtor) {
      return null
    }

    if (!context) {
      context = new AudioCtor()
    }

    if (context.state === 'suspended') {
      context.resume()
    }

    return context
  }

  const beep = (frequency, duration, type = 'sine', volume = 0.04, sweep = 0) => {
    if (!enabled) {
      return
    }

    const audioContext = ensureContext()
    if (!audioContext) {
      return
    }

    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime)
    if (sweep !== 0) {
      oscillator.frequency.linearRampToValueAtTime(
        frequency + sweep,
        audioContext.currentTime + duration,
      )
    }

    gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gainNode.gain.exponentialRampToValueAtTime(volume, audioContext.currentTime + 0.02)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration)

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + duration)
  }

  return {
    setEnabled(value) {
      enabled = value
      if (!enabled && context) {
        context.suspend()
      } else if (enabled) {
        ensureContext()
      }
    },
    play(type) {
      if (!enabled) {
        return
      }

      switch (type) {
        case 'coin':
          beep(880, 0.1, 'triangle', 0.06, 120)
          break
        case 'collision':
          beep(120, 0.18, 'sawtooth', 0.08, -60)
          break
        case 'countdown':
          beep(540, 0.18, 'square', 0.04, 30)
          break
        case 'go':
          beep(720, 0.22, 'triangle', 0.05, 80)
          break
        case 'overtake':
          beep(1100, 0.12, 'triangle', 0.05, 160)
          break
        case 'nearMiss':
          beep(980, 0.1, 'sine', 0.04, 50)
          break
        case 'button':
          beep(440, 0.06, 'square', 0.03, 30)
          break
        case 'level':
          beep(650, 0.18, 'triangle', 0.05, 90)
          break
        case 'gameover':
          beep(200, 0.4, 'sawtooth', 0.06, -100)
          break
        case 'engine':
          beep(140, 0.06, 'sawtooth', 0.02, 10)
          break
        default:
          beep(420, 0.08, 'sine', 0.03, 20)
      }
    },
  }
}

function App() {
  const audioRef = useRef(null)
  const worldRef = useRef(buildWorld())
  const [phase, setPhase] = useState('menu')
  const [countdownValue, setCountdownValue] = useState('3')
  const [soundEnabled, setSoundEnabled] = useState(worldRef.current.soundEnabled)
  const controlsRef = useRef({
    accelerate: false,
    brake: false,
    left: false,
    right: false,
  })
  const [sceneData, setSceneData] = useState({
    traffic: worldRef.current.traffic,
    coins: worldRef.current.coins,
    roadSegments: worldRef.current.roadSegments,
    particles: worldRef.current.particles,
    level: 1,
    weather: 0,
  })
  const [hud, setHud] = useState({
    score: 0,
    coins: 0,
    level: 1,
    distance: 0,
    best: worldRef.current.bestScore,
    accidents: 0,
    health: 100,
    speed: 0,
    maxSpeed: 0,
    totalCoins: worldRef.current.totalCoins,
    healthGlow: false,
    levelName: LEVEL_NAMES[0],
  })
  const [floatingTexts, setFloatingTexts] = useState([])
  const [showMainMenu, setShowMainMenu] = useState(true)
  const [gameOverStats, setGameOverStats] = useState(null)
  const [levelCompleteStats, setLevelCompleteStats] = useState(null)

  useEffect(() => {
    audioRef.current = createAudioManager(soundEnabled)
  }, [soundEnabled])

  const addFloatingText = (text, x = 58, y = 34) => {
    const id = `${Date.now()}-${Math.random()}`
    setFloatingTexts((current) => [...current, { id, text, x, y }])
    window.setTimeout(() => {
      setFloatingTexts((current) => current.filter((entry) => entry.id !== id))
    }, 850)
  }

  const applyLevelToWorld = (level) => {
    const world = worldRef.current
    world.player.level = level
    const themeIndex = (level - 1) % WEATHER_THEMES.length
    world.weather = themeIndex
    setSceneData((current) => ({ ...current, level, weather: themeIndex }))
  }

  const updateHud = () => {
    const world = worldRef.current
    const speedKm = Math.round(world.player.speed * 1.2)
    const level = clamp(Math.floor(world.player.distance / 1200) + 1, 1, LEVEL_NAMES.length)
    const distanceKm = (world.player.distance / 1000).toFixed(1)
    setHud({
      score: Math.max(0, world.player.score),
      coins: world.player.coins,
      level,
      distance: Number(distanceKm),
      best: world.bestScore,
      accidents: world.player.accidents,
      health: clamp(world.player.health, 0, 100),
      speed: speedKm,
      maxSpeed: world.player.maxSpeed,
      totalCoins: world.totalCoins,
      levelName: LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)],
      healthGlow: world.player.health < 35,
    })
  }

  const persistStats = () => {
    const world = worldRef.current
    setStoredValue(STORAGE_KEYS.bestScore, world.bestScore)
    setStoredValue(STORAGE_KEYS.totalCoins, world.totalCoins)
    setStoredValue(STORAGE_KEYS.sound, world.soundEnabled)
  }

  const resetWorld = () => {
    const freshWorld = buildWorld()
    freshWorld.bestScore = worldRef.current.bestScore
    freshWorld.totalCoins = worldRef.current.totalCoins
    freshWorld.soundEnabled = soundEnabled
    worldRef.current = freshWorld
    setSceneData({
      traffic: freshWorld.traffic,
      coins: freshWorld.coins,
      roadSegments: freshWorld.roadSegments,
      particles: freshWorld.particles,
      level: 1,
      weather: 0,
    })
    setHud({
      score: 0,
      coins: 0,
      level: 1,
      distance: 0,
      best: freshWorld.bestScore,
      accidents: 0,
      health: 100,
      speed: 0,
      maxSpeed: 0,
      totalCoins: freshWorld.totalCoins,
      healthGlow: false,
      levelName: LEVEL_NAMES[0],
    })
    setGameOverStats(null)
    setLevelCompleteStats(null)
    setShowMainMenu(false)
    setCountdownValue('3')
    applyLevelToWorld(1)
  }

  const startCountdown = () => {
    resetWorld()
    setPhase('countdown')
    const steps = ['3', '2', '1', 'GO!']

    steps.forEach((value, index) => {
      window.setTimeout(() => {
        setCountdownValue(value)
        if (value !== 'GO!') {
          audioRef.current?.play('countdown')
        } else {
          audioRef.current?.play('go')
          setPhase('playing')
        }
      }, index * 780)
    })
  }

  const setSoundState = (value) => {
    const next = Boolean(value)
    setSoundEnabled(next)
    worldRef.current.soundEnabled = next
    audioRef.current?.setEnabled(next)
    persistStats()
  }

  const pauseGame = () => {
    if (phase === 'playing') {
      setPhase('paused')
      audioRef.current?.play('button')
    } else if (phase === 'paused') {
      setPhase('playing')
      audioRef.current?.play('button')
    }
  }

  const toMenu = () => {
    setPhase('menu')
    setShowMainMenu(true)
    setCountdownValue('3')
    resetWorld()
  }

  const restartRace = () => {
    setPhase('countdown')
    startCountdown()
  }

  const nextLevel = () => {
    const world = worldRef.current
    const next = clamp(world.player.level + 1, 1, LEVEL_NAMES.length)
    const nextRequirement = next * 1400
    world.player.level = next
    world.distanceTarget = nextRequirement
    world.player.distance = world.player.distance % 1000
    world.player.score += 500
    applyLevelToWorld(next)
    setLevelCompleteStats(null)
    setPhase('playing')
    audioRef.current?.play('level')
    addFloatingText('LEVEL UP', 60, 22)
  }

  useEffect(() => {
    const handleKeyDown = (event) => {
      const key = event.key.toLowerCase()
      if (['w', 'a', 's', 'd', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'p', 'r', 'escape'].includes(key)) {
        event.preventDefault()
      }

      if (key === 'w' || key === 'arrowup') controlsRef.current.accelerate = true
      if (key === 's' || key === 'arrowdown' || key === ' ') controlsRef.current.brake = true
      if (key === 'a' || key === 'arrowleft') controlsRef.current.left = true
      if (key === 'd' || key === 'arrowright') controlsRef.current.right = true

      if (key === 'p') {
        pauseGame()
      }
      if (key === 'r' && phase === 'gameover') {
        restartRace()
      }
      if (key === 'escape') {
        pauseGame()
      }
    }

    const handleKeyUp = (event) => {
      const key = event.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') controlsRef.current.accelerate = false
      if (key === 's' || key === 'arrowdown' || key === ' ') controlsRef.current.brake = false
      if (key === 'a' || key === 'arrowleft') controlsRef.current.left = false
      if (key === 'd' || key === 'arrowright') controlsRef.current.right = false
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [phase])

  useEffect(() => {
    persistStats()
  }, [soundEnabled])

  const setControlHold = (key, value) => {
    controlsRef.current[key] = Boolean(value)
  }

  const updateWorld = (delta) => {
    const world = worldRef.current
    const controls = controlsRef.current
    if (phase !== 'playing') {
      return
    }

    const activeThrottle = controls.accelerate ? 44 : 0
    const activeBrake = controls.brake ? 74 : 0
    const steerForce = (controls.right ? 1 : 0) - (controls.left ? 1 : 0)

    world.player.speed += (activeThrottle - activeBrake) * delta
    world.player.speed -= world.player.speed * 0.28 * delta
    world.player.speed = clamp(world.player.speed, 0, MAX_SPEED)

    if (!controls.accelerate && !controls.brake) {
      world.player.speed -= 10 * delta
      world.player.speed = Math.max(world.player.speed, 0)
    }

    world.player.targetX += steerForce * 4.2 * delta
    world.player.targetX = clamp(world.player.targetX, -5.5, 5.5)
    world.player.x = lerp(world.player.x, world.player.targetX, 0.12)
    world.player.lean = lerp(world.player.lean, steerForce * 0.65, 0.14)
    world.player.brakeLights = Boolean(controls.brake && world.player.speed > 8)

    world.player.distance += world.player.speed * delta * 7.4
    world.player.maxSpeed = Math.max(world.player.maxSpeed, world.player.speed)
    world.player.score += Math.max(0, Math.floor(world.player.speed * 0.12 * delta))

    const levelValue = clamp(Math.floor(world.player.distance / 1200) + 1, 1, LEVEL_NAMES.length)
    if (levelValue !== world.player.level) {
      world.player.level = levelValue
      applyLevelToWorld(levelValue)
      addFloatingText(`LEVEL ${levelValue}`, 54, 20)
      audioRef.current?.play('level')
    }

    if (world.player.distance >= world.player.level * 1200 && phase === 'playing') {
      world.player.score += 500
      setLevelCompleteStats({
        score: world.player.score,
        coins: world.player.coins,
        distance: Number((world.player.distance / 1000).toFixed(1)),
        maxSpeed: world.player.maxSpeed,
      })
      setPhase('levelcomplete')
      addFloatingText('LEVEL COMPLETE', 54, 16)
      audioRef.current?.play('level')
    }

    const relativeSpeed = world.player.speed * 0.6 + 14
    for (const segment of world.roadSegments) {
      segment.z -= relativeSpeed * delta * 0.7
      if (segment.z < -30) {
        segment.z += 280
      }
    }

    for (const vehicle of world.traffic) {
      vehicle.z -= (relativeSpeed + vehicle.speed) * delta * 0.52
      if (vehicle.z < -28) {
        if (!vehicle.passed) {
          vehicle.passed = true
          world.player.score += 50
          addFloatingText('+50', 58, 20)
          audioRef.current?.play('overtake')
        }
        const laneIndex = Math.floor(Math.random() * LANE_X.length)
        vehicle.x = LANE_X[laneIndex]
        vehicle.z = 70 + Math.random() * 80
        vehicle.speed = randomBetween(28, 90) + world.player.level * 6
        vehicle.passed = false
        vehicle.nearMissed = false
        vehicle.hit = false
      }

      if (
        vehicle.z > -6 &&
        vehicle.z < 8 &&
        !vehicle.nearMissed &&
        Math.abs(vehicle.x - world.player.x) < 1.8 &&
        Math.abs(vehicle.z) > 1.2
      ) {
        vehicle.nearMissed = true
        world.player.score += 25
        addFloatingText('NEAR MISS +25', 58, 26)
        audioRef.current?.play('nearMiss')
      }

      if (Math.abs(vehicle.z) < 1.7 && Math.abs(vehicle.x - world.player.x) < 1.35 && !vehicle.hit) {
        vehicle.hit = true
        const damage = world.player.speed > 120 ? 40 : world.player.speed > 70 ? 25 : 15
        world.player.health = clamp(world.player.health - damage, 0, 100)
        world.player.accidents += 1
        world.player.score = Math.max(0, world.player.score - 30)
        world.player.speed *= 0.45
        world.player.targetX = clamp(world.player.targetX + (world.player.x < vehicle.x ? -1.7 : 1.7), -5.5, 5.5)
        addFloatingText(`-${damage}%`, 66, 22)
        audioRef.current?.play('collision')
        if (world.player.health <= 0) {
          world.bestScore = Math.max(world.bestScore, world.player.score)
          world.totalCoins = Math.max(world.totalCoins, world.player.coins)
          persistStats()
          setGameOverStats({
            score: world.player.score,
            coins: world.player.coins,
            distance: Number((world.player.distance / 1000).toFixed(1)),
            maxSpeed: world.player.maxSpeed,
            accidents: world.player.accidents,
            best: world.bestScore,
            newBest: world.player.score >= world.bestScore,
          })
          setPhase('gameover')
          audioRef.current?.play('gameover')
        }
      }
    }

    for (const coin of world.coins) {
      coin.z -= relativeSpeed * delta * 0.7
      coin.spin += delta * 7
      if (coin.z < -10) {
        coin.collected = true
      }
      if (!coin.collected && Math.abs(coin.z) < 2 && Math.abs(coin.x - world.player.x) < 1.6) {
        coin.collected = true
        world.player.coins += 1
        world.totalCoins += 1
        world.player.score += 10
        world.bestScore = Math.max(world.bestScore, world.player.score)
        addFloatingText('+10', 62, 18)
        audioRef.current?.play('coin')
        persistStats()
      }
    }

    world.coins = world.coins.filter((coin) => !coin.collected)
    while (world.coins.length < 14) {
      const laneIndex = Math.floor(Math.random() * LANE_X.length)
      const zStart = 28 + Math.random() * 110 + (world.coins.at(-1)?.z ?? 0)
      const coinLine = buildCoinLine(zStart, [laneIndex, (laneIndex + 1) % 3, (laneIndex + 2) % 3])
      world.coins.push(...coinLine)
    }

    if (!world.particles.length) {
      world.particles = Array.from({ length: 16 }, (_, index) => ({
        id: index,
        x: randomBetween(-5, 5),
        y: 0.7,
        z: randomBetween(0, 200),
        color: '#f6d365',
        life: randomBetween(0.6, 1.6),
      }))
    }

    for (const particle of world.particles) {
      particle.z -= relativeSpeed * delta * 0.5
      particle.life -= delta
    }
    world.particles = world.particles.filter((particle) => particle.life > 0)

    updateHud()
    setSceneData({
      traffic: world.traffic,
      coins: world.coins,
      roadSegments: world.roadSegments,
      particles: world.particles,
      level: world.player.level,
      weather: (world.player.level - 1) % WEATHER_THEMES.length,
    })
  }

  return (
    <div className="app-shell">
      <div className="game-stage">
        <Canvas camera={{ position: [0, 5.5, 9.5], fov: 52 }}>
          <RaceScene
            phase={phase}
            data={sceneData}
            player={worldRef.current.player}
            updateWorld={updateWorld}
            soundEnabled={soundEnabled}
          />
        </Canvas>

        <div className="hud">
          <div className="hud-top row">
            <div className="panel small-panel">
              <span className="label">PLAYER</span>
              <strong>{PLAYER_NAME}</strong>
            </div>
            <div className="panel center-panel">
              <span className="label">SCORE</span>
              <strong>{hud.score.toLocaleString()}</strong>
            </div>
            <div className="panel small-panel right">
              <span className="label">COINS</span>
              <strong>{hud.coins}</strong>
            </div>
          </div>

          <div className="hud-middle row">
            <div className="panel small-panel">
              <span className="label">LEVEL</span>
              <strong>{hud.level}</strong>
            </div>
            <div className="panel small-panel wide">
              <span className="label">{hud.levelName}</span>
              <div className="health-wrap">
                <div className="health-bar">
                  <span style={{ width: `${hud.health}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="hud-bottom row">
            <div className="panel small-panel">
              <span className="label">SPEED</span>
              <strong>{hud.speed} KM/H</strong>
            </div>
            <div className="panel small-panel">
              <span className="label">DISTANCE</span>
              <strong>{hud.distance.toFixed(1)} KM</strong>
            </div>
            <div className="panel small-panel">
              <span className="label">BEST</span>
              <strong>{hud.best.toLocaleString()}</strong>
            </div>
            <div className="panel small-panel">
              <span className="label">ACCIDENTS</span>
              <strong>{hud.accidents}</strong>
            </div>
          </div>
        </div>

        <div className="floating-annotations">
          {floatingTexts.map((entry) => (
            <div
              key={entry.id}
              className="floating-text"
              style={{ left: `${entry.x}%`, top: `${entry.y}%` }}
            >
              {entry.text}
            </div>
          ))}
        </div>

        {phase === 'menu' && (
          <div className="overlay menu-overlay">
            <div className="menu-panel">
              <div className="title-block">
                <span className="eyebrow">PAVAN RACING 3D</span>
                <h1>{PLAYER_NAME}</h1>
              </div>
              <div className="score-cards">
                <div className="stat-box">
                  <span>BEST SCORE</span>
                  <strong>{hud.best.toLocaleString()}</strong>
                </div>
                <div className="stat-box">
                  <span>TOTAL COINS</span>
                  <strong>{hud.totalCoins}</strong>
                </div>
              </div>
              <button type="button" className="primary-button" onClick={startCountdown}>
                ▶ START RACE
              </button>
              <div className="menu-actions">
                <button type="button" className="secondary-button" onClick={() => setSoundState(!soundEnabled)}>
                  {soundEnabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}
                </button>
                <button type="button" className="secondary-button" onClick={() => setPhase('paused')}>
                  CONTROLS
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'countdown' && (
          <div className="countdown-overlay">
            <div className="countdown-number">{countdownValue}</div>
          </div>
        )}

        {phase === 'paused' && (
          <div className="overlay menu-overlay">
            <div className="menu-panel compact-panel">
              <h2>GAME PAUSED</h2>
              <div className="stacked-actions">
                <button type="button" className="primary-button" onClick={() => setPhase('playing')}>
                  ▶ RESUME
                </button>
                <button type="button" className="secondary-button" onClick={restartRace}>
                  🔄 RESTART
                </button>
                <button type="button" className="secondary-button" onClick={toMenu}>
                  🏠 MAIN MENU
                </button>
                <button type="button" className="secondary-button" onClick={() => setSoundState(!soundEnabled)}>
                  {soundEnabled ? '🔊 SOUND ON' : '🔇 SOUND OFF'}
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'gameover' && gameOverStats && (
          <div className="overlay menu-overlay">
            <div className="menu-panel compact-panel">
              <h2>GAME OVER</h2>
              <div className="summary-grid">
                <span>PLAYER</span>
                <strong>{PLAYER_NAME}</strong>
                <span>FINAL SCORE</span>
                <strong>{gameOverStats.score.toLocaleString()}</strong>
                <span>COINS</span>
                <strong>{gameOverStats.coins}</strong>
                <span>DISTANCE</span>
                <strong>{gameOverStats.distance} KM</strong>
                <span>MAX SPEED</span>
                <strong>{gameOverStats.maxSpeed.toFixed(0)} KM/H</strong>
                <span>ACCIDENTS</span>
                <strong>{gameOverStats.accidents}</strong>
                <span>BEST SCORE</span>
                <strong>{gameOverStats.best.toLocaleString()}</strong>
              </div>
              {gameOverStats.newBest && <div className="new-best">🏆 NEW BEST SCORE!</div>}
              <div className="stacked-actions">
                <button type="button" className="primary-button" onClick={restartRace}>
                  🔄 RESTART
                </button>
                <button type="button" className="secondary-button" onClick={toMenu}>
                  🏠 MAIN MENU
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'levelcomplete' && levelCompleteStats && (
          <div className="overlay menu-overlay">
            <div className="menu-panel compact-panel">
              <h2>🏆 LEVEL COMPLETE</h2>
              <div className="summary-grid">
                <span>PLAYER</span>
                <strong>{PLAYER_NAME}</strong>
                <span>SCORE</span>
                <strong>{levelCompleteStats.score.toLocaleString()}</strong>
                <span>COINS</span>
                <strong>{levelCompleteStats.coins}</strong>
                <span>DISTANCE</span>
                <strong>{levelCompleteStats.distance} KM</strong>
                <span>MAX SPEED</span>
                <strong>{levelCompleteStats.maxSpeed.toFixed(0)} KM/H</strong>
              </div>
              <div className="stacked-actions">
                <button type="button" className="primary-button" onClick={nextLevel}>
                  NEXT LEVEL
                </button>
                <button type="button" className="secondary-button" onClick={restartRace}>
                  REPLAY
                </button>
                <button type="button" className="secondary-button" onClick={toMenu}>
                  MAIN MENU
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="control-panel">
          <button
            type="button"
            className={`touch-button ${controlsRef.current.left ? 'pressed' : ''}`}
            onPointerDown={() => setControlHold('left', true)}
            onPointerUp={() => setControlHold('left', false)}
            onPointerLeave={() => setControlHold('left', false)}
            onPointerCancel={() => setControlHold('left', false)}
          >
            LEFT
          </button>
          <button
            type="button"
            className={`touch-button ${controlsRef.current.right ? 'pressed' : ''}`}
            onPointerDown={() => setControlHold('right', true)}
            onPointerUp={() => setControlHold('right', false)}
            onPointerLeave={() => setControlHold('right', false)}
            onPointerCancel={() => setControlHold('right', false)}
          >
            RIGHT
          </button>
          <button
            type="button"
            className={`touch-button ${controlsRef.current.accelerate ? 'pressed' : ''}`}
            onPointerDown={() => setControlHold('accelerate', true)}
            onPointerUp={() => setControlHold('accelerate', false)}
            onPointerLeave={() => setControlHold('accelerate', false)}
            onPointerCancel={() => setControlHold('accelerate', false)}
          >
            ACCELERATE
          </button>
          <button
            type="button"
            className={`touch-button ${controlsRef.current.brake ? 'pressed' : ''}`}
            onPointerDown={() => setControlHold('brake', true)}
            onPointerUp={() => setControlHold('brake', false)}
            onPointerLeave={() => setControlHold('brake', false)}
            onPointerCancel={() => setControlHold('brake', false)}
          >
            BRAKE
          </button>
          <button type="button" className="touch-button small" onClick={pauseGame}>
            PAUSE
          </button>
          <button type="button" className="touch-button small" onClick={() => setSoundState(!soundEnabled)}>
            {soundEnabled ? 'SOUND' : 'MUTE'}
          </button>
        </div>
      </div>
    </div>
  )
}

function RaceScene({ data, player, updateWorld, phase }) {
  const cameraTarget = useRef([0, 1.5, 0])
  const rainRef = useRef([])
  const weather = WEATHER_THEMES[data.weather % WEATHER_THEMES.length]

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.033)
    updateWorld(dt)

    const cameraX = player.x * 0.8
    const cameraY = 4.8 + Math.min(player.speed, 140) * 0.01
    const cameraZ = 9.2 + Math.min(player.speed, 180) * 0.04
    cameraTarget.current[0] = lerp(cameraTarget.current[0], cameraX, 0.08)
    cameraTarget.current[1] = lerp(cameraTarget.current[1], cameraY, 0.08)
    cameraTarget.current[2] = lerp(cameraTarget.current[2], cameraZ, 0.08)

    state.camera.position.x = cameraTarget.current[0]
    state.camera.position.y = cameraTarget.current[1]
    state.camera.position.z = cameraTarget.current[2]
    state.camera.lookAt(player.x * 0.6, 1.2, -4)
    state.camera.fov = 52 + Math.min(player.speed, 180) * 0.08
    state.camera.updateProjectionMatrix()
  })

  return (
    <>
      <ambientLight intensity={0.9} color={weather.ambient} />
      <directionalLight position={[8, 14, 6]} intensity={1.2} color={weather.sun} />
      <fog attach="fog" args={[weather.fog, 18, 120]} />
      <color attach="background" args={[weather.sky]} />

      <group position={[0, 0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]} receiveShadow>
          <planeGeometry args={[80, 260]} />
          <meshStandardMaterial color="#2d7d46" />
        </mesh>

        {data.roadSegments.map((segment) => (
          <RoadSegment key={segment.id} z={segment.z} level={data.level} />
        ))}

        {data.traffic.map((vehicle) => (
          <TrafficVehicle key={vehicle.id} vehicle={vehicle} />
        ))}

        {data.coins.map((coin) => (
          <CoinMesh key={coin.id} coin={coin} />
        ))}

        {data.particles.map((particle, index) => (
          <mesh key={`${particle.id}-${index}`} position={[particle.x, particle.y, particle.z]}>
            <sphereGeometry args={[0.25, 10, 10]} />
            <meshBasicMaterial color={particle.color} transparent opacity={Math.max(0, particle.life)} />
          </mesh>
        ))}

        <PlayerCar player={player} phase={phase} />
      </group>

      {data.level >= 3 && (
        <RainParticles ref={rainRef} active={data.level >= 3} />
      )}
    </>
  )
}

function RoadSegment({ z, level }) {
  const isNight = level >= 3
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry args={[13.5, 0.4, 28]} />
        <meshStandardMaterial color={isNight ? '#1a1a1a' : '#3f3f3f'} />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[8.4, 0.08, 28]} />
        <meshStandardMaterial color="#262626" />
      </mesh>

      {[-4.2, 0, 4.2].map((x, i) => (
        <group key={`${x}-${i}`} position={[x, 0.15, 0]}>
          {[...Array(6)].map((_, markerIndex) => (
            <mesh key={markerIndex} position={[0, 0.04, -10 + markerIndex * 5]}>
              <boxGeometry args={[0.24, 0.06, 2.4]} />
              <meshStandardMaterial color="#f4f4f4" />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[-8.4, 0.05, 0]}>
        <boxGeometry args={[0.7, 0.2, 28]} />
        <meshStandardMaterial color="#d0d5dd" />
      </mesh>
      <mesh position={[8.4, 0.05, 0]}>
        <boxGeometry args={[0.7, 0.2, 28]} />
        <meshStandardMaterial color="#d0d5dd" />
      </mesh>

      {[...Array(6)].map((_, index) => {
        const side = index % 2 === 0 ? -1 : 1
        return (
          <group key={`tree-${index}`} position={[side * 14, 0, -8 + index * 5]}>
            <mesh position={[0, 1.2, 0]} castShadow>
              <cylinderGeometry args={[0.4, 0.6, 2.5, 10]} />
              <meshStandardMaterial color="#7b614c" />
            </mesh>
            <mesh position={[0, 2.8, 0]} castShadow>
              <coneGeometry args={[1.6, 3, 10]} />
              <meshStandardMaterial color="#2f8f5d" />
            </mesh>
          </group>
        )
      })}

      {[...Array(5)].map((_, index) => (
        <group key={`light-${index}`} position={[(index % 2 === 0 ? -1 : 1) * 11, 0.1, -8 + index * 5.5]}>
          <mesh position={[0, 1.8, 0]} castShadow>
            <cylinderGeometry args={[0.15, 0.15, 3.6, 8]} />
            <meshStandardMaterial color="#2d2e36" />
          </mesh>
          <mesh position={[0, 3.4, 0]}>
            <sphereGeometry args={[0.25, 12, 12]} />
            <meshStandardMaterial color={isNight ? '#f8f5be' : '#c5d6ff'} emissive="#ffe4a3" />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function PlayerCar({ player, phase }) {
  const isNight = player.level >= 3
  const speedGlow = clamp(player.speed / MAX_SPEED, 0, 1)
  const headlightColor = isNight ? '#fff8c2' : '#dff8ff'
  const brakeColor = phase === 'playing' && player.brakeLights ? '#ff3038' : '#a71924'

  return (
    <group position={[player.x, 0.5, 0]} rotation={[0, 0, -player.lean * 0.7]}>
      <mesh position={[0, 0.28, 0]} scale={[1, 0.34, 1]} castShadow>
        <sphereGeometry args={[1, 20, 12]} />
        <meshStandardMaterial color="#0e6fff" metalness={0.82} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.5, 0.18]} scale={[0.74, 0.31, 0.82]} castShadow>
        <sphereGeometry args={[1, 18, 10]} />
        <meshStandardMaterial color="#081d3e" metalness={0.65} roughness={0.12} />
      </mesh>
      <mesh position={[0, 0.59, 0.98]} scale={[0.56, 0.2, 0.45]}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshStandardMaterial color="#0a1630" metalness={0.55} roughness={0.08} />
      </mesh>
      <mesh position={[0, 0.03, 0.2]} castShadow>
        <boxGeometry args={[1.95, 0.22, 3.65]} />
        <meshStandardMaterial color="#0757d9" metalness={0.78} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.32, 1.77]} scale={[0.82, 0.2, 0.34]}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshStandardMaterial color="#087dff" metalness={0.8} roughness={0.18} />
      </mesh>
      <mesh position={[0, -0.03, 2.02]} castShadow>
        <boxGeometry args={[2.18, 0.12, 0.42]} />
        <meshStandardMaterial color="#111827" metalness={0.45} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.18, -1.86]} castShadow>
        <boxGeometry args={[2.25, 0.16, 0.35]} />
        <meshStandardMaterial color="#101827" metalness={0.5} roughness={0.3} />
      </mesh>
      {[-0.76, 0.76].map((x) => (
        <mesh key={`side-skirt-${x}`} position={[x, 0.08, 0]}>
          <boxGeometry args={[0.16, 0.22, 2.9]} />
          <meshStandardMaterial color="#062d80" metalness={0.72} roughness={0.2} />
        </mesh>
      ))}
      {[-0.62, 0.62].map((x) => (
        <mesh key={`stripe-${x}`} position={[x, 0.305, 0.24]}>
          <boxGeometry args={[0.12, 0.025, 3.38]} />
          <meshStandardMaterial color={x < 0 ? '#ff2939' : '#ffd23f'} emissive={x < 0 ? '#8a0715' : '#735000'} emissiveIntensity={0.55} />
        </mesh>
      ))}
      <mesh position={[0, 0.32, -0.25]}>
        <boxGeometry args={[0.16, 0.03, 2.65]} />
        <meshStandardMaterial color="#4aff78" emissive="#22ff66" emissiveIntensity={1.2} />
      </mesh>
      {[-0.92, 0.92].map((x) => (
        <mesh key={`vent-${x}`} position={[x, 0.28, 0.83]} rotation={[0, x < 0 ? -0.25 : 0.25, 0]}>
          <boxGeometry args={[0.18, 0.06, 0.7]} />
          <meshStandardMaterial color="#02050a" roughness={0.85} />
        </mesh>
      ))}
      {[-0.76, 0.76].map((x) => (
        <group key={`wheel-front-${x}`} position={[x, -0.06, 1.22]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.43, 0.43, 0.3, 20]} />
            <meshStandardMaterial color="#090b10" roughness={0.88} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.25, 0.055, 8, 18]} />
            <meshStandardMaterial color="#ffd23f" metalness={0.95} roughness={0.16} emissive="#6b4300" emissiveIntensity={0.35} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.16, 0.16, 0.34, 16]} />
            <meshStandardMaterial color="#202a38" metalness={0.9} roughness={0.16} />
          </mesh>
        </group>
      ))}
      {[-0.76, 0.76].map((x) => (
        <group key={`wheel-rear-${x}`} position={[x, -0.06, -1.27]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.46, 0.46, 0.32, 20]} />
            <meshStandardMaterial color="#090b10" roughness={0.88} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.27, 0.055, 8, 18]} />
            <meshStandardMaterial color="#ffd23f" metalness={0.95} roughness={0.16} emissive="#6b4300" emissiveIntensity={0.35} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.17, 0.17, 0.36, 16]} />
            <meshStandardMaterial color="#202a38" metalness={0.9} roughness={0.16} />
          </mesh>
        </group>
      ))}
      {[-0.72, 0.72].map((x) => (
        <mesh key={`head-${x}`} position={[x, 0.34, 1.97]} rotation={[0, x < 0 ? -0.16 : 0.16, 0]}>
          <boxGeometry args={[0.62, 0.1, 0.25]} />
          <meshStandardMaterial color={headlightColor} emissive="#7eeeff" emissiveIntensity={1.1 + speedGlow * 1.1} />
        </mesh>
      ))}
      {[-0.73, 0.73].map((x) => (
        <mesh key={`tail-${x}`} position={[x, 0.28, -1.86]}>
          <boxGeometry args={[0.56, 0.12, 0.16]} />
          <meshStandardMaterial color={brakeColor} emissive="#ff1f31" emissiveIntensity={player.brakeLights ? 2.4 : 0.65} />
        </mesh>
      ))}
      <group position={[0, 0.68, -1.58]}>
        <mesh position={[-0.78, 0, 0]}>
          <boxGeometry args={[0.12, 0.78, 0.12]} />
          <meshStandardMaterial color="#161c28" metalness={0.75} roughness={0.25} />
        </mesh>
        <mesh position={[0.78, 0, 0]}>
          <boxGeometry args={[0.12, 0.78, 0.12]} />
          <meshStandardMaterial color="#161c28" metalness={0.75} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0.38, 0]}>
          <boxGeometry args={[2.15, 0.12, 0.38]} />
          <meshStandardMaterial color="#101722" metalness={0.78} roughness={0.2} />
        </mesh>
        <mesh position={[0, 0.41, 0.01]}>
          <boxGeometry args={[1.82, 0.035, 0.2]} />
          <meshStandardMaterial color="#ff3347" emissive="#bf061d" emissiveIntensity={0.7} />
        </mesh>
      </group>
      <mesh position={[0, -0.65, 0]} receiveShadow>
        <circleGeometry args={[2.5, 32]} />
        <meshStandardMaterial color="#000000" transparent opacity={0.35} />
      </mesh>
    </group>
  )
}

function TrafficVehicle({ vehicle }) {
  const isNight = vehicle.z < 50
  return (
    <group position={[vehicle.x, 0.55, vehicle.z]} rotation={[0, 0, 0]}>
      <mesh position={[0, 0.25, 0]} castShadow>
        <boxGeometry args={[1.6, 0.7, 3.2]} />
        <meshStandardMaterial color={vehicle.color} metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.72, 0.2]} castShadow>
        <boxGeometry args={[1.12, 0.5, 1.8]} />
        <meshStandardMaterial color="#dfe8ff" metalness={0.7} roughness={0.12} />
      </mesh>
      {[-0.74, 0.74].map((x) => (
        <group key={x} position={[x, -0.12, 0.95]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.3, 18]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
        </group>
      ))}
      {[-0.74, 0.74].map((x) => (
        <group key={`rear-${x}`} position={[x, -0.12, -0.95]}>
          <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
            <cylinderGeometry args={[0.32, 0.32, 0.3, 18]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
        </group>
      ))}
      {[-0.52, 0.52].map((x) => (
        <mesh key={`light-${x}`} position={[x, 0.35, 1.7]}>
          <boxGeometry args={[0.34, 0.12, 0.1]} />
          <meshStandardMaterial color={isNight ? '#fff0a8' : '#dfe7ff'} emissive="#fdf2a8" emissiveIntensity={isNight ? 1.5 : 0.8} />
        </mesh>
      ))}
    </group>
  )
}

function CoinMesh({ coin }) {
  return (
    <group position={[coin.x, coin.y, coin.z]} rotation={[Math.PI / 2, 0, coin.spin]}>
      <mesh castShadow>
        <torusGeometry args={[0.75, 0.28, 10, 28]} />
        <meshStandardMaterial color="#ffd34d" emissive="#ffb703" emissiveIntensity={1.4} metalness={0.95} roughness={0.2} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]}>
        <ringGeometry args={[0.35, 0.45, 26]} />
        <meshBasicMaterial color="#fff5b8" transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

function RainParticles() {
  const points = useMemo(
    () =>
      Array.from({ length: 110 }, () => ({
        x: randomBetween(-18, 18),
        y: randomBetween(6, 22),
        z: randomBetween(-40, 150),
      })),
    [],
  )

  return (
    <group>
      {points.map((point, index) => (
        <mesh key={index} position={[point.x, point.y, point.z]}>
          <boxGeometry args={[0.08, 0.8, 0.08]} />
          <meshBasicMaterial color="#cfe8ff" />
        </mesh>
      ))}
    </group>
  )
}

export default App
