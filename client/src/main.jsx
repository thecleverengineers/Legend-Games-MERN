import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  BrowserRouter,
  NavLink,
  Navigate,
  Outlet,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api, dateTime, inr, shortDate } from "./api";
import "./styles.css";

const AuthContext = createContext(null);
const useAuth = () => useContext(AuthContext);
const staffRoles = ["admin", "manager"];

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setUser((await api("/auth/me")).user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const value = useMemo(
    () => ({ user, setUser, refresh, loading }),
    [user, refresh, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function Notice({ children }) {
  return (
    <div className="notice">
      <span>◉</span>
      {children}
    </div>
  );
}
function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}
function Empty({ text = "Nothing to show yet" }) {
  return (
    <div className="empty">
      <span>✦</span>
      <p>{text}</p>
    </div>
  );
}
function Message({ children, error = false }) {
  return children ? (
    <p className={error ? "error" : "success"}>{children}</p>
  ) : null;
}
function PageHeader({ title, action, eyebrow = "Legend Games" }) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      {action}
    </header>
  );
}
function isFailure(message) {
  return /error|incorrect|invalid|unable|failed|required|not found|already|unavailable|closed|insufficient/i.test(
    message || "",
  );
}

function AppShell() {
  const { user } = useAuth();
  const nav = [
    ["/", "/images/home.png", "Home"],
    ["/rewards", "/images/checkIn.png", "Activity"],
    ["/team", "/images/invite.webp", "Promotion"],
    ["/wallet", "/images/wallet2.png", "Wallet"],
    ["/profile", "/images/me2.png", "Account"],
  ];

  return (
    <main className="legacy-react-shell">
      <header className="legacy-navbar">
        <NavLink to="/" className="legacy-navbar-logo" aria-label="Legend Games home">
          <img
            src="/h5setting_202308141709544lm1.png"
            alt="Legend Games"
            onError={(event) => {
              event.currentTarget.src = "/images/headlogo.png";
            }}
          />
        </NavLink>
        <div className="legacy-navbar-spacer" />
        <NavLink
          to="/notification"
          className="legacy-notification"
          aria-label="Notifications"
          title="Notifications"
        >
          <span>♢</span>
          <i />
        </NavLink>
      </header>

      <section className="legacy-page-content">
        <Outlet />
      </section>

      <NavLink to="/support" className="legacy-customer-service" aria-label="Support">
        <img
          src="/assets/png/icon_sevice-8a1f5628.png"
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
        <span>?</span>
      </NavLink>

      <nav className="legacy-tabbar" aria-label="Main navigation">
        {nav.map(([to, icon, label], index) => (
          <NavLink
            key={label}
            to={to}
            end={to === "/"}
            className={index === 2 ? "legacy-tab legacy-tab-promotion" : "legacy-tab"}
          >
            <span className="legacy-tab-icon">
              <img
                src={icon}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <b>{index === 0 ? "⌂" : index === 1 ? "☆" : index === 2 ? "◆" : index === 3 ? "▣" : "●"}</b>
            </span>
            <small>{label}</small>
          </NavLink>
        ))}
        {staffRoles.includes(user?.role) && (
          <NavLink to="/admin" className="legacy-staff-shortcut" title="Staff">
            ▦
          </NavLink>
        )}
      </nav>
    </main>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}
function StaffProtected() {
  const { user } = useAuth();
  return staffRoles.includes(user?.role) ? (
    <Outlet />
  ) : (
    <Navigate to="/" replace />
  );
}
function AgentProtected() {
  const { user } = useAuth();
  return ["admin", "manager", "agent"].includes(user?.role) ? (
    <Outlet />
  ) : (
    <Navigate to="/team" replace />
  );
}

function AuthPage({ register = false }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (user) return <Navigate to="/" replace />;
  const submit = async (event) => {
    event.preventDefault();
    setMessage("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const data = register
        ? await api("/auth/register", {
            method: "POST",
            body: {
              name: form.get("name"),
              email: form.get("email") || undefined,
              phone: form.get("phone") || undefined,
              password: form.get("password"),
              referralCode: form.get("referralCode") || undefined,
            },
          })
        : await api("/auth/login", {
            method: "POST",
            body: {
              identifier: form.get("identifier"),
              password: form.get("password"),
            },
          });
      setUser(data.user);
      navigate("/");
    } catch (reason) {
      setMessage(reason.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <img
          src="/images/headlogo.png"
          alt="Legend Games"
          onError={(event) => event.currentTarget.remove()}
        />
        <h1>
          Play the
          <br />
          <em>legendary way.</em>
        </h1>
        <p>
          One account for the games, rewards, wallet, team and support flows you
          already use.
        </p>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <p className="eyebrow">Welcome to Legend Games</p>
        <h2>{register ? "Create your account" : "Sign in"}</h2>
        <Message error>{message}</Message>
        {register && (
          <label>
            Full name
            <input
              name="name"
              autoComplete="name"
              required
              placeholder="Your name"
            />
          </label>
        )}
        <label>
          {register ? "Email address" : "Email or phone"}
          <input
            name={register ? "email" : "identifier"}
            autoComplete={register ? "email" : "username"}
            required
            placeholder={
              register ? "you@example.com" : "you@example.com or 9876543210"
            }
          />
        </label>
        {register && (
          <label>
            Phone number <span className="optional">optional</span>
            <input name="phone" autoComplete="tel" placeholder="9876543210" />
          </label>
        )}
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            minLength="10"
            required
            placeholder="At least 10 characters"
          />
        </label>
        {register && (
          <label>
            Referral code <span className="optional">optional</span>
            <input name="referralCode" placeholder="LGXXXXXX" />
          </label>
        )}
        <button className="primary wide" disabled={busy}>
          {busy ? "Please wait…" : register ? "Create account" : "Sign in"}
        </button>
        {!register && (
          <p className="auth-switch">
            <NavLink to="/forgot">Forgot password?</NavLink>
          </p>
        )}
        <p className="auth-switch">
          {register ? "Already registered?" : "New to Legend Games?"}{" "}
          <NavLink to={register ? "/login" : "/register"}>
            {register ? "Sign in" : "Create account"}
          </NavLink>
        </p>
      </form>
    </div>
  );
}

function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState("request");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [identifier, setIdentifier] = useState("");
  const requestReset = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = String(form.get("identifier") || "");
    setBusy(true);
    setMessage("");
    try {
      const data = await api("/auth/password-reset/request", {
        method: "POST",
        body: { identifier: value },
      });
      setIdentifier(value);
      setMessage(
        data.developmentCode
          ? `Development code: ${data.developmentCode}`
          : data.message,
      );
      setStage("confirm");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const confirmReset = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await api("/auth/password-reset/confirm", {
        method: "POST",
        body: {
          identifier,
          code: form.get("code"),
          newPassword: form.get("newPassword"),
        },
      });
      navigate("/");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="auth-page">
      <div className="auth-art">
        <img
          src="/images/headlogo.png"
          alt="Legend Games"
          onError={(event) => event.currentTarget.remove()}
        />
        <h1>
          Reset your
          <br />
          <em>password.</em>
        </h1>
        <p>Use a verified email or phone delivery provider in production.</p>
      </div>
      <form
        className="auth-card"
        onSubmit={stage === "request" ? requestReset : confirmReset}
      >
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h2>
          {stage === "request" ? "Request code" : "Choose a new password"}
        </h2>
        <Message error={isFailure(message)}>{message}</Message>
        {stage === "request" ? (
          <label>
            Email or phone
            <input
              name="identifier"
              required
              placeholder="you@example.com or 9876543210"
            />
          </label>
        ) : (
          <>
            <label>
              Verification code
              <input
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                required
                placeholder="6 digit code"
              />
            </label>
            <label>
              New password
              <input
                name="newPassword"
                type="password"
                minLength="10"
                required
              />
            </label>
          </>
        )}
        <button className="primary wide" disabled={busy}>
          {busy
            ? "Please wait…"
            : stage === "request"
              ? "Send reset code"
              : "Reset password"}
        </button>
        <p className="auth-switch">
          <NavLink to="/login">Back to sign in</NavLink>
        </p>
      </form>
    </div>
  );
}

function HomePage() {
  const { user } = useAuth();
  const [games, setGames] = useState([]);
  const [bannerIndex, setBannerIndex] = useState(0);

  useEffect(() => {
    api("/games")
      .then((data) => setGames(data.games || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setInterval(
      () => setBannerIndex((current) => (current + 1) % 10),
      3800,
    );
    return () => window.clearInterval(timer);
  }, []);

  const banners = Array.from({ length: 10 }, (_, index) => `/banner/BANNER_${index + 1}.jpg`);
  const categoryTiles = [
    {
      name: "Popular",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240221154444kutg.png",
      background: "/assets/png/popular-044514e1.png",
      target: "#popular",
      wide: true,
    },
    {
      name: "Lottery",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240221154540veqj.png",
      background: "/assets/png/lottery-c0a9176b.png",
      target: "#lottery",
      wide: true,
    },
    {
      name: "Casino",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240529195514q4uq.png",
      background: "/assets/png/video-c9dce622.png",
      target: "/games",
    },
    {
      name: "Slots",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240221154558lshk.png",
      background: "/assets/png/slot-bf07af03.png",
      target: "/games",
    },
    {
      name: "Sports",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240221154454akso.png",
      background: "/assets/png/sport-ac79bf87.png",
      target: "/games",
    },
    {
      name: "Rummy",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_202404151616441889.png",
      background: "/assets/png/chess-9c4d1dff.png",
      target: "/games",
    },
    {
      name: "Fishing",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240221164829vcfa.png",
      background: "/assets/png/fish-a70df76d.png",
      target: "/games",
    },
    {
      name: "Original",
      icon: "https://ossimg.tirangaagent.com/Tiranga/gamecategory/gamecategory_20240415161436vabi.png",
      background: "/assets/png/flash-eac62fa4.png",
      target: "/games",
    },
  ];

  const findRoute = (terms) => {
    const match = games.find((game) =>
      terms.some((term) => game.name?.toLowerCase().includes(term)),
    );
    return match ? `/games/${match.id}` : "/games";
  };

  const lotteryGames = [
    {
      name: "Win Go",
      image: "https://ossimg.tirangaagent.com/Tiranga/lotterycategory/lotterycategory_20240124125544jt65.png",
      route: findRoute(["win go", "wingo"]),
      tint: "rgba(147, 10, 161, 0.52)",
    },
    {
      name: "K3",
      image: "https://ossimg.tirangaagent.com/Tiranga/lotterycategory/lotterycategory_20240124125551se9i.png",
      route: findRoute(["k3"]),
      tint: "rgba(155, 63, 63, 0.52)",
    },
    {
      name: "5D",
      image: "https://ossimg.tirangaagent.com/Tiranga/lotterycategory/lotterycategory_20240124125558slo1.png",
      route: findRoute(["5d", "five"]),
      tint: "rgba(255, 0, 0, 0.52)",
    },
    {
      name: "Trx Win Go",
      image: "https://ossimg.tirangaagent.com/Tiranga/lotterycategory/lotterycategory_20240124125606db4a.png",
      route: findRoute(["trx"]),
      tint: "rgba(255, 109, 0, 0.52)",
    },
  ];

  return (
    <div className="legacy-home">
      <section className="legacy-banner">
        <div className="legacy-banner-track">
          {banners.map((src, index) => (
            <img
              key={src}
              src={src}
              alt=""
              className={index === bannerIndex ? "active" : ""}
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
            />
          ))}
        </div>
        <div className="legacy-banner-dots">
          {banners.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Show banner ${index + 1}`}
              className={index === bannerIndex ? "active" : ""}
              onClick={() => setBannerIndex(index)}
            />
          ))}
        </div>
      </section>

      <section className="legacy-noticebar">
        <span className="legacy-speaker">◖</span>
        <div>
          Welcome to the Legend Games! Greetings, Gamers and Enthusiasts! Enjoy the
          original game catalogue, activities, rewards and play-coin wallet.
        </div>
        <NavLink to="/notification">Detail</NavLink>
      </section>

      <section className="legacy-account-strip">
        <div>
          <span>Play coin balance</span>
          <strong>{inr(user.wallet?.total)}</strong>
        </div>
        <NavLink to="/wallet">Wallet</NavLink>
      </section>

      <section className="legacy-game-menu" id="popular">
        {categoryTiles.map((tile) => {
          const content = (
            <>
              <img className="legacy-category-bg" src={tile.background} alt="" />
              <img className="legacy-category-icon" src={tile.icon} alt="" />
              <span>{tile.name}</span>
            </>
          );
          const className = tile.wide
            ? "legacy-category-tile legacy-category-wide"
            : "legacy-category-tile";
          return tile.target.startsWith("#") ? (
            <a href={tile.target} className={className} key={tile.name}>
              {content}
            </a>
          ) : (
            <NavLink to={tile.target} className={className} key={tile.name}>
              {content}
            </NavLink>
          );
        })}
      </section>

      <section className="legacy-game-section" id="lottery">
        <div className="legacy-section-title">
          <h2>Lottery</h2>
          <NavLink to="/games">
            All <span>{lotteryGames.length}</span> ›
          </NavLink>
        </div>
        <div className="legacy-lottery-grid">
          {lotteryGames.map((game) => (
            <NavLink
              to={game.route}
              className="legacy-lottery-card"
              style={{ background: game.tint }}
              key={game.name}
            >
              <h3>{game.name}</h3>
              <img src={game.image} alt="" />
              <span>GO ›</span>
            </NavLink>
          ))}
        </div>
      </section>

      <section className="legacy-game-section">
        <div className="legacy-section-title">
          <h2>Popular games</h2>
          <NavLink to="/games">
            All <span>{games.length}</span> ›
          </NavLink>
        </div>
        <div className="legacy-popular-grid">
          {games.slice(0, 8).map((game) => (
            <NavLink to={`/games/${game.id}`} className="legacy-popular-card" key={game.id}>
              <img src={game.image} alt="" />
              <div>
                <strong>{game.name}</strong>
                <small>{game.category || "Game"}</small>
              </div>
            </NavLink>
          ))}
        </div>
      </section>
    </div>
  );
}

const defaultChoice = (game) =>
  game?.kind === "five_d" ? "00000" : game?.choices?.[0] || "";
function outcomeLabel(outcome) {
  if (!outcome) return "—";
  if (outcome.dice) return outcome.dice.join(" · ");
  return outcome.number ?? JSON.stringify(outcome);
}
function GamePage() {
  const { game: requestedGame } = useParams();
  const { user, refresh } = useAuth();
  const [data, setData] = useState({ games: [], rounds: [] });
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState(10);
  const [choice, setChoice] = useState("");
  const [clock, setClock] = useState(Date.now());
  const reload = useCallback(async () => {
    const payload = await api("/games");
    setData(payload);
  }, []);
  useEffect(() => {
    reload().catch((error) => setMessage(error.message));
    const timer = setInterval(() => reload().catch(() => {}), 12_000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const active =
    data.games.find((item) => item.id === requestedGame) ||
    data.games.find((item) => !item.external);
  useEffect(() => {
    if (active) setChoice(defaultChoice(active));
  }, [active?.id]);
  useEffect(() => {
    if (!active || active.external) {
      setHistory([]);
      return undefined;
    }
    let cancelled = false;
    api(`/games/${active.id}/history`)
      .then((payload) => {
        if (!cancelled) setHistory(payload.rounds || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [active?.id]);
  if (!active)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  const round = data.rounds.find((item) => item.game === active.id);
  const seconds = round
    ? Math.max(
        0,
        Math.ceil((new Date(round.closesAt).getTime() - clock) / 1000),
      )
    : 0;
  const bet = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await api(`/games/${active.id}/bets`, {
        method: "POST",
        body: { selection: choice, amount: Number(amount) },
      });
      setMessage(`Bet accepted for ${response.round.period}.`);
      await refresh();
      await reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const launch = async () => {
    setBusy(true);
    setMessage("");
    try {
      const response = await api(`/providers/${active.provider}/launch`, {
        method: "POST",
        body: { gameId: active.id, returnUrl: window.location.href },
      });
      window.location.assign(response.url);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Games"
        action={
          <span className="mode-pill">
            {active.external ? "Provider" : "Live rounds"}
          </span>
        }
      />
      <div className="game-tabs">
        {data.games.map((game) => (
          <NavLink
            key={game.id}
            to={`/games/${game.id}`}
            className={({ isActive }) =>
              isActive || (!requestedGame && game.id === active.id)
                ? "active"
                : ""
            }
          >
            {game.name}
          </NavLink>
        ))}
      </div>
      <section className="game-play">
        <div className="round-panel">
          <div>
            <p className="eyebrow">{active.category}</p>
            <h2>{active.name}</h2>
            <p>
              {active.external
                ? "This keeps the existing provider catalogue. Launch becomes available as soon as licensed provider credentials are configured."
                : "Choose your prediction before the current round closes."}
            </p>
          </div>
          <img src={active.image} alt="" />
          {!active.external && (
            <div className="round-status">
              <span>
                Period <b>{round?.period?.split("-").at(-1) || "—"}</b>
              </span>
              <strong>{seconds}s</strong>
              <span>
                Seed <b>{round?.serverSeedHash?.slice(0, 10)}…</b>
              </span>
            </div>
          )}
        </div>
        {active.external ? (
          <div className="integration-card">
            <span>◌</span>
            <h3>{active.shortName} catalogue</h3>
            <p>
              All original provider categories are retained. A configured
              provider launch opens securely from this screen.
            </p>
            <button className="primary wide" disabled={busy} onClick={launch}>
              {busy ? "Opening…" : `Open ${active.shortName}`}
            </button>
            <Message error>{message}</Message>
          </div>
        ) : (
          <div className="bet-panel">
            <p className="eyebrow">PLACE A BET</p>
            {active.kind === "five_d" ? (
              <>
                <label>
                  Five digit number
                  <input
                    value={choice}
                    onChange={(event) =>
                      setChoice(
                        event.target.value.replace(/\D/g, "").slice(0, 5),
                      )
                    }
                    placeholder="00000"
                    inputMode="numeric"
                    maxLength="5"
                  />
                </label>
                <div className="choice-grid compact">
                  {["00000", "12345", "54321", "position:0:0", "total:20"].map(
                    (item) => (
                      <button
                        key={item}
                        className={
                          choice === item ? "choice active-choice" : "choice"
                        }
                        onClick={() => setChoice(item)}
                      >
                        {item.replace("position:", "P").replace("total:", "T")}
                      </button>
                    ),
                  )}
                </div>
              </>
            ) : (
              <div className="choice-grid">
                {active.choices.map((item) => (
                  <button
                    key={item}
                    className={
                      choice === item
                        ? `choice ${item} active-choice`
                        : `choice ${item}`
                    }
                    onClick={() => setChoice(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            )}
            <div className="amount-row">
              <label>
                Stake
                <input
                  type="number"
                  min="10"
                  step="10"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </label>
              <div>
                {[10, 50, 100, 500].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmount(value)}
                  >
                    ₹{value}
                  </button>
                ))}
              </div>
            </div>
            <button
              className="primary wide"
              disabled={busy || seconds === 0 || !choice}
              onClick={bet}
            >
              {busy ? "Placing bet…" : `Bet ${inr(amount)}`}
            </button>
            <Message error={isFailure(message)}>{message}</Message>
            <p className="balance-note">
              Available balance: {inr(user.wallet?.total)}
            </p>
          </div>
        )}
      </section>
      {!active.external && (
        <section className="history-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">RESULT HISTORY</p>
              <h2>Recent rounds</h2>
            </div>
          </div>
          {history.length ? (
            <div className="round-history">
              {history.slice(0, 12).map((item) => (
                <div key={item.id}>
                  <span>{item.period.split("-").at(-1)}</span>
                  <b>{outcomeLabel(item.outcome)}</b>
                  <small>{item.serverSeedHash?.slice(0, 12)}…</small>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="Settled rounds will appear here." />
          )}
        </section>
      )}
      <section className="section-heading">
        <div>
          <p className="eyebrow">CATALOGUE</p>
          <h2>All games</h2>
        </div>
      </section>
      <div className="game-grid">
        {data.games.map((game) => (
          <NavLink className="game-card" to={`/games/${game.id}`} key={game.id}>
            <img src={game.image} alt="" />
            <div>
              <small>{game.category}</small>
              <h3>{game.name}</h3>
              <span>{game.external ? "Open provider →" : "Open game →"}</span>
            </div>
          </NavLink>
        ))}
      </div>
    </>
  );
}

function WalletPage() {
  const { user, refresh } = useAuth();
  const [tab, setTab] = useState("deposit");
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [requests, setRequests] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDestination, setShowDestination] = useState(false);
  const reload = useCallback(async () => {
    const [wallet, ledger, payments, saved] = await Promise.all([
      api("/wallet/summary"),
      api("/wallet/transactions"),
      api("/wallet/requests"),
      api("/wallet/destinations"),
    ]);
    setSummary(wallet);
    setTransactions(ledger.transactions);
    setRequests(payments.requests);
    setDestinations(saved.destinations);
  }, []);
  useEffect(() => {
    reload().catch((error) => setMessage(error.message));
  }, [reload]);
  const submit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      if (tab === "deposit")
        await api("/wallet/deposits", {
          method: "POST",
          body: {
            amount: Number(form.get("amount")),
            channel: form.get("channel"),
            note: form.get("note"),
            utr: form.get("utr") || undefined,
            evidenceUrl: form.get("evidenceUrl") || undefined,
          },
        });
      if (tab === "withdraw")
        await api("/wallet/withdrawals", {
          method: "POST",
          body: {
            amount: Number(form.get("amount")),
            channel: form.get("channel"),
            destinationId: form.get("destinationId") || undefined,
            note: form.get("note"),
          },
        });
      if (tab === "transfer")
        await api("/wallet/transfers", {
          method: "POST",
          body: {
            recipient: form.get("recipient"),
            amount: Number(form.get("amount")),
            note: form.get("note"),
          },
        });
      setMessage(
        tab === "transfer"
          ? "Transfer complete."
          : "Your request is now awaiting review.",
      );
      event.currentTarget.reset();
      await refresh();
      await reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const addDestination = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const type = form.get("type");
      await api("/wallet/destinations", {
        method: "POST",
        body: {
          type,
          label: form.get("label"),
          accountName: form.get("accountName") || undefined,
          accountNumber: form.get("accountNumber") || undefined,
          ifsc: form.get("ifsc") || undefined,
          upiId: form.get("upiId") || undefined,
          network: form.get("network") || undefined,
          address: form.get("address") || undefined,
        },
      });
      setMessage("Payout destination saved.");
      setShowDestination(false);
      await reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="Wallet"
        action={
          <button
            className="text-button"
            onClick={() => setShowDestination((value) => !value)}
          >
            Payout methods
          </button>
        }
      />
      <section className="wallet-hero">
        <div>
          <p>Available balance</p>
          <strong>{inr(user.wallet?.total)}</strong>
          <span>
            Cash {inr(user.wallet?.cash)} · Bonus {inr(user.wallet?.bonus)}
          </span>
        </div>
        <span className="wallet-orb">◈</span>
      </section>
      {summary && (
        <div className="pending-row">
          <span>
            Pending deposits <b>{inr(summary.pending?.deposit)}</b>
          </span>
          <span>
            Pending withdrawals <b>{inr(summary.pending?.withdrawal)}</b>
          </span>
        </div>
      )}
      <div className="wallet-tabs">
        {[
          ["deposit", "Add funds"],
          ["withdraw", "Withdraw"],
          ["transfer", "Transfer"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setMessage("");
            }}
            className={tab === id ? "active" : ""}
          >
            {label}
          </button>
        ))}
      </div>
      {showDestination && (
        <form
          className="transaction-form compact-form"
          onSubmit={addDestination}
        >
          <p className="eyebrow">SAVE PAYOUT METHOD</p>
          <div className="form-grid">
            <label>
              Method
              <select name="type" defaultValue="upi">
                <option value="upi">UPI</option>
                <option value="bank">Bank</option>
                <option value="crypto">Crypto</option>
              </select>
            </label>
            <label>
              Label
              <input name="label" required placeholder="My account" />
            </label>
            <label>
              Account holder
              <input name="accountName" />
            </label>
            <label>
              Account number
              <input name="accountNumber" />
            </label>
            <label>
              IFSC
              <input name="ifsc" />
            </label>
            <label>
              UPI ID
              <input name="upiId" placeholder="name@bank" />
            </label>
            <label>
              Network
              <input name="network" placeholder="TRC20" />
            </label>
            <label>
              Wallet address
              <input name="address" />
            </label>
          </div>
          <button className="outline wide" disabled={busy}>
            Save payout method
          </button>
        </form>
      )}
      <form className="transaction-form" onSubmit={submit}>
        <p className="eyebrow">
          {tab === "deposit"
            ? "CREATE A DEPOSIT REQUEST"
            : tab === "withdraw"
              ? "REQUEST A WITHDRAWAL"
              : "SEND BALANCE"}
        </p>
        {tab === "transfer" && (
          <label>
            Recipient email, phone or referral code
            <input name="recipient" required placeholder="LGXXXXXX" />
          </label>
        )}
        <label>
          Amount
          <input
            name="amount"
            type="number"
            required
            min="10"
            step="10"
            placeholder="Minimum ₹10"
          />
        </label>
        {tab !== "transfer" && (
          <label>
            Channel
            <select name="channel" defaultValue="manual">
              <option value="manual">Manual review</option>
              <option value="upi">UPI</option>
              <option value="bank">Bank transfer</option>
              <option value="crypto">Crypto</option>
            </select>
          </label>
        )}
        {tab === "withdraw" && (
          <label>
            Saved payout method{" "}
            <span className="optional">optional in demo</span>
            <select name="destinationId" defaultValue="">
              <option value="">Manual destination</option>
              {destinations.map((destination) => (
                <option key={destination._id} value={destination._id}>
                  {destination.label} · {destination.masked}
                </option>
              ))}
            </select>
          </label>
        )}
        {tab === "deposit" && (
          <div className="form-grid">
            <label>
              UTR/reference <span className="optional">optional</span>
              <input name="utr" />
            </label>
            <label>
              Evidence URL <span className="optional">optional</span>
              <input name="evidenceUrl" type="url" />
            </label>
          </div>
        )}
        <label>
          Note <span className="optional">optional</span>
          <input
            name="note"
            maxLength="140"
            placeholder="Reference or message"
          />
        </label>
        <button className="primary wide" disabled={busy}>
          {busy
            ? "Submitting…"
            : tab === "deposit"
              ? "Create deposit request"
              : tab === "withdraw"
                ? "Request withdrawal"
                : "Send transfer"}
        </button>
        <Message error={isFailure(message)}>{message}</Message>
      </form>
      <section className="section-heading">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h2>Recent transactions</h2>
        </div>
        <NavLink to="/history">Game history →</NavLink>
      </section>
      {transactions.length ? (
        <div className="ledger">
          {transactions.map((item) => (
            <div className="ledger-item" key={item._id}>
              <span className={`ledger-icon ${item.direction}`}>
                {item.direction === "credit" ? "+" : "−"}
              </span>
              <div>
                <strong>{item.type.replaceAll("_", " ")}</strong>
                <small>
                  {item.description || item.reference} ·{" "}
                  {dateTime(item.createdAt)}
                </small>
              </div>
              <b className={item.direction}>
                {item.direction === "credit" ? "+" : "−"}
                {inr(item.amount)}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="Your wallet activity will appear here." />
      )}
      {requests.length > 0 && (
        <>
          <section className="section-heading">
            <div>
              <p className="eyebrow">PAYMENT QUEUE</p>
              <h2>Your requests</h2>
            </div>
          </section>
          <div className="request-list">
            {requests.slice(0, 10).map((item) => (
              <div key={item._id}>
                <span className={`status ${item.status}`}>{item.status}</span>
                <strong>
                  {item.type} · {inr(item.amount)}
                </strong>
                <small>
                  {item.reference} · {dateTime(item.createdAt)}
                </small>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function RewardsPage() {
  const { refresh } = useAuth();
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(
    () =>
      api("/promotions")
        .then(setData)
        .catch((error) => setMessage(error.message)),
    [],
  );
  useEffect(() => {
    reload();
  }, [reload]);
  const claim = async (path, label) => {
    setBusy(true);
    setMessage("");
    try {
      const result = await api(path, { method: "POST", body: {} });
      setMessage(`${label}: ${inr(result.amount)} added to your wallet.`);
      await refresh();
      reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const redeem = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await api("/promotions/gift-codes/redeem", {
        method: "POST",
        body: { code: form.get("code") },
      });
      setMessage(`${inr(result.amount)} gift credit added.`);
      event.currentTarget.reset();
      await refresh();
      reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return (
    <>
      <PageHeader title="Rewards" />
      <section className="reward-hero">
        <div>
          <p className="eyebrow">DAILY CHECK-IN</p>
          <h2>
            Come back daily.
            <br />
            Grow your balance.
          </h2>
          <p>
            Daily rewards, attendance, deposits, invitations and VIP levels
            remain available from this one activity page.
          </p>
          <button
            className="primary"
            disabled={busy || data.dailyCheckin?.claimed}
            onClick={() => claim("/promotions/daily-checkin", "Daily check-in")}
          >
            {data.dailyCheckin?.claimed
              ? "Claimed today ✓"
              : busy
                ? "Claiming…"
                : `Claim ${inr(data.dailyCheckin?.amount)}`}
          </button>
          <Message error={isFailure(message)}>{message}</Message>
        </div>
        <span>✦</span>
      </section>
      <div className="reward-grid extended">
        <article>
          <span>◌</span>
          <p className="eyebrow">ATTENDANCE</p>
          <h3>{data.attendance?.currentStreak || 0} day streak</h3>
          <p>Next attendance reward: {inr(data.attendance?.nextReward)}</p>
          <button
            className="outline wide"
            disabled={busy || data.attendance?.claimedToday}
            onClick={() => claim("/promotions/attendance", "Attendance")}
          >
            {data.attendance?.claimedToday
              ? "Claimed today"
              : "Claim attendance"}
          </button>
        </article>
        <article>
          <span>◈</span>
          <p className="eyebrow">DEPOSIT REWARDS</p>
          <h3>Recharge bonus</h3>
          <p>
            Today: {inr(data.dailyDeposit?.depositedToday)}. First deposit and
            daily deposit reward rules are retained.
          </p>
          <div className="button-stack">
            <button
              className="outline wide"
              disabled={
                busy ||
                !data.firstDeposit?.eligible ||
                data.firstDeposit?.claimed
              }
              onClick={() =>
                claim("/promotions/first-deposit", "First deposit")
              }
            >
              {data.firstDeposit?.claimed
                ? "First bonus claimed"
                : "Claim first deposit"}
            </button>
            <button
              className="outline wide"
              disabled={
                busy ||
                !data.dailyDeposit?.eligible ||
                data.dailyDeposit?.claimed
              }
              onClick={() =>
                claim("/promotions/daily-deposit", "Daily deposit")
              }
            >
              {data.dailyDeposit?.claimed
                ? "Daily bonus claimed"
                : "Claim daily deposit"}
            </button>
          </div>
        </article>
        <article>
          <span>♛</span>
          <p className="eyebrow">VIP STATUS</p>
          <h3>VIP {data.vip?.level || 0}</h3>
          <p>
            {inr(data.vip?.currentWagered)} lifetime wagered. Tier history is
            calculated from wallet records.
          </p>
          <NavLink to="/team">View team →</NavLink>
        </article>
        <article>
          <span>⌁</span>
          <p className="eyebrow">GIFT CODE</p>
          <h3>Redeem reward</h3>
          <p>
            Use the same gift/red-envelope campaign flow with a single-use
            ledger record.
          </p>
          <form className="inline-form" onSubmit={redeem}>
            <input name="code" required placeholder="Gift code" />
            <button className="primary" disabled={busy}>
              Redeem
            </button>
          </form>
        </article>
      </div>
      <section className="section-heading">
        <div>
          <p className="eyebrow">INVITE FRIENDS</p>
          <h2>Share your code</h2>
        </div>
        <strong className="referral-code">{data.referral?.code}</strong>
      </section>
      <div className="invite-card">
        <p>
          Every eligible signup appears here for its invitation reward. Your
          referral link can use this code: <b>{data.referral?.code}</b>.
        </p>
        {data.referral?.claimable?.length ? (
          <div className="claim-list">
            {data.referral.claimable.map((person) => (
              <button
                key={person.id}
                className="outline"
                disabled={busy}
                onClick={() =>
                  claim(`/promotions/invitation/${person.id}`, "Invitation")
                }
              >
                {person.name || "New member"} · claim{" "}
                {inr(data.referral.rewardPerSignup)}
              </button>
            ))}
          </div>
        ) : (
          <small>
            {data.referral?.signups || 0} signup
            {data.referral?.signups === 1 ? "" : "s"} so far
          </small>
        )}
      </div>
    </>
  );
}

function TeamPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  const load = useCallback(
    () =>
      api("/team")
        .then(setData)
        .catch((error) => setMessage(error.message)),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  if (!data)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return (
    <>
      <PageHeader
        title="My team"
        action={
          <NavLink to="/rewards" className="text-action">
            Rewards →
          </NavLink>
        }
      />
      <div className="admin-stats team-stats">
        <article>
          <span>Direct members</span>
          <strong>{data.totals?.members || 0}</strong>
        </article>
        <article>
          <span>Team deposits</span>
          <strong>{inr(data.totals?.deposits)}</strong>
        </article>
        <article>
          <span>Team wagers</span>
          <strong>{inr(data.totals?.wagered)}</strong>
        </article>
        <article>
          <span>Commissions</span>
          <strong>{inr(data.totals?.commissions)}</strong>
        </article>
      </div>
      <Message error>{message}</Message>
      <section className="section-heading">
        <div>
          <p className="eyebrow">SUBORDINATES</p>
          <h2>Members</h2>
        </div>
      </section>
      {data.members?.length ? (
        <div className="admin-list users">
          {data.members.map((member) => (
            <article key={member._id}>
              <div className="user-line">
                <span className="avatar small">
                  {member.name?.slice(0, 1) || "P"}
                </span>
                <div>
                  <h3>{member.name}</h3>
                  <p>
                    {member.email || member.phone} · {member.role}
                  </p>
                </div>
              </div>
              <div>
                <strong>
                  {inr(
                    (member.wallet?.cash || 0) + (member.wallet?.bonus || 0),
                  )}
                </strong>
                <small className={`status ${member.status}`}>
                  {member.status}
                </small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty text="Members who join with your referral code will appear here." />
      )}
      <Notice>
        Team commissions are recorded separately from deposits and wagers for
        auditability.
      </Notice>
    </>
  );
}

function HistoryPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/games/history?limit=100")
      .then(setData)
      .catch((error) => setMessage(error.message));
  }, []);
  if (!data && !message)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return (
    <>
      <PageHeader title="Game history" />
      <Message error>{message}</Message>
      {data?.bets?.length ? (
        <div className="ledger">
          {data.bets.map((bet) => (
            <div className="ledger-item" key={bet._id}>
              <span
                className={`ledger-icon ${bet.status === "won" ? "credit" : "debit"}`}
              >
                {bet.status === "won" ? "+" : "−"}
              </span>
              <div>
                <strong>
                  {bet.game} · {bet.selectionKey}
                </strong>
                <small>
                  {bet.round?.period || "—"} · {dateTime(bet.createdAt)}
                </small>
              </div>
              <b className={bet.status === "won" ? "credit" : "debit"}>
                {bet.status === "won" ? inr(bet.payout) : inr(bet.amount)}
              </b>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="Your completed game bets will appear here." />
      )}
    </>
  );
}

function ProfilePage() {
  const { user, setUser, refresh } = useAuth();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const update = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const data = await api("/auth/me", {
        method: "PATCH",
        body: { name: form.get("name"), avatar: form.get("avatar") },
      });
      setUser(data.user);
      setMessage("Profile updated.");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const password = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: {
          currentPassword: form.get("currentPassword"),
          newPassword: form.get("newPassword"),
        },
      });
      event.currentTarget.reset();
      setMessage("Password updated.");
      await refresh();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        title="My profile"
        action={
          <NavLink to="/salary" className="text-action">
            Salary →
          </NavLink>
        }
      />
      <section className="profile-card">
        <span className="profile-avatar">
          {user.name?.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h2>{user.name}</h2>
          <p>{user.email || user.phone}</p>
          <span className={`status ${user.kyc?.status}`}>
            KYC: {user.kyc?.status?.replaceAll("_", " ")}
          </span>
        </div>
      </section>
      <form className="transaction-form" onSubmit={update}>
        <p className="eyebrow">PERSONAL DETAILS</p>
        <label>
          Name
          <input name="name" defaultValue={user.name} required />
        </label>
        <label>
          Avatar URL or existing asset path{" "}
          <span className="optional">optional</span>
          <input
            name="avatar"
            defaultValue={user.avatar}
            placeholder="/images/avatar.png"
          />
        </label>
        <div className="readonly-grid">
          <span>
            Referral code<b>{user.referralCode}</b>
          </span>
          <span>
            VIP level<b>{user.vipLevel}</b>
          </span>
          <span>
            Account type<b>{user.role}</b>
          </span>
          <span>
            Joined<b>{shortDate(user.createdAt)}</b>
          </span>
        </div>
        <button className="primary wide" disabled={busy}>
          Save profile
        </button>
        <Message error={isFailure(message)}>{message}</Message>
      </form>
      <form className="transaction-form secondary-form" onSubmit={password}>
        <p className="eyebrow">SECURITY</p>
        <label>
          Current password
          <input name="currentPassword" type="password" required />
        </label>
        <label>
          New password
          <input name="newPassword" type="password" minLength="10" required />
        </label>
        <button className="outline wide" disabled={busy}>
          Change password
        </button>
      </form>
    </>
  );
}

function SalaryPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/salary/records")
      .then(setData)
      .catch((error) => setMessage(error.message));
  }, []);
  if (!data && !message)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return (
    <>
      <PageHeader
        title="Salary records"
        action={
          <NavLink to="/profile" className="text-action">
            Profile →
          </NavLink>
        }
      />
      <Message error>{message}</Message>
      {data?.records?.length ? (
        <div className="ledger">
          {data.records.map((record) => (
            <div className="ledger-item" key={record._id}>
              <span className="ledger-icon credit">+</span>
              <div>
                <strong>
                  {record.type} salary · {record.status}
                </strong>
                <small>
                  {record.periodKey} ·{" "}
                  {dateTime(record.paidAt || record.createdAt)}
                </small>
              </div>
              <b className="credit">+{inr(record.amount)}</b>
            </div>
          ))}
        </div>
      ) : (
        <Empty text="Salary payments will appear here when an eligible period is paid." />
      )}
    </>
  );
}

function SupportPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/support")
      .then(setData)
      .catch((error) => setMessage(error.message));
  }, []);
  const send = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api("/feedback", {
        method: "POST",
        body: { topic: form.get("topic"), message: form.get("message") },
      });
      setMessage("Your feedback has been recorded.");
      event.currentTarget.reset();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Support" />
      <section className="integration-card support-card">
        <span>◌</span>
        <h3>Contact channels</h3>
        <p>
          {data?.channels?.email ||
          data?.channels?.telegram ||
          data?.channels?.whatsapp
            ? [
                data.channels.email,
                data.channels.telegram,
                data.channels.whatsapp,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Support contact details can be configured through environment variables."}
        </p>
      </section>
      <form className="transaction-form" onSubmit={send}>
        <p className="eyebrow">SEND FEEDBACK</p>
        <label>
          Topic
          <select name="topic">
            <option value="support">Support</option>
            <option value="payment">Payment</option>
            <option value="game">Game</option>
            <option value="bug">Bug</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          Message
          <textarea
            name="message"
            required
            minLength="5"
            maxLength="2000"
            placeholder="Tell the team what you need."
          />
        </label>
        <button className="primary wide" disabled={busy}>
          {busy ? "Sending…" : "Send feedback"}
        </button>
        <Message error={isFailure(message)}>{message}</Message>
      </form>
    </>
  );
}

function AdminPage() {
  const [dashboard, setDashboard] = useState(null);
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [codes, setCodes] = useState([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const [summary, payments, people, gifts] = await Promise.all([
      api("/admin/dashboard"),
      api("/admin/payment-requests"),
      api("/admin/users?limit=25"),
      api("/admin/gift-codes"),
    ]);
    setDashboard(summary);
    setRequests(payments.requests);
    setUsers(people.users);
    setCodes(gifts.codes);
  }, []);
  useEffect(() => {
    reload().catch((error) => setMessage(error.message));
  }, [reload]);
  const review = async (id, decision) => {
    setBusy(true);
    try {
      await api(`/admin/payment-requests/${id}/review`, {
        method: "POST",
        body: { decision },
      });
      setMessage("Payment request reviewed.");
      await reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  const createGift = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await api("/admin/gift-codes", {
        method: "POST",
        body: {
          code: form.get("code"),
          amount: Number(form.get("amount")),
          bucket: form.get("bucket"),
          maxUses: Number(form.get("maxUses")),
          expiresAt: form.get("expiresAt") || undefined,
          note: form.get("note") || undefined,
        },
      });
      setMessage("Gift code created.");
      event.currentTarget.reset();
      await reload();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  };
  if (!dashboard)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return (
    <>
      <PageHeader
        title="Admin console"
        action={<span className="mode-pill">Operations</span>}
      />
      <div className="admin-stats">
        <article>
          <span>Players</span>
          <strong>{dashboard.users}</strong>
        </article>
        <article>
          <span>Open bets</span>
          <strong>{dashboard.openBets}</strong>
        </article>
        <article>
          <span>Pending deposits</span>
          <strong>{dashboard.payments.deposit?.count || 0}</strong>
          <small>{inr(dashboard.payments.deposit?.amount)}</small>
        </article>
        <article>
          <span>Pending withdrawals</span>
          <strong>{dashboard.payments.withdrawal?.count || 0}</strong>
          <small>{inr(dashboard.payments.withdrawal?.amount)}</small>
        </article>
      </div>
      <Message error={isFailure(message)}>{message}</Message>
      <section className="section-heading">
        <div>
          <p className="eyebrow">REVIEW QUEUE</p>
          <h2>Pending payments</h2>
        </div>
      </section>
      {requests.length ? (
        <div className="admin-list">
          {requests.map((request) => (
            <article key={request._id}>
              <div>
                <span className={`status ${request.type}`}>{request.type}</span>
                <h3>
                  {inr(request.amount)} <small>{request.channel}</small>
                </h3>
                <p>
                  {request.user?.name || request.user?.phone} ·{" "}
                  {request.reference}
                </p>
                <small>{dateTime(request.createdAt)}</small>
              </div>
              <div className="review-buttons">
                <button
                  className="approve"
                  disabled={busy}
                  onClick={() => review(request._id, "approve")}
                >
                  Approve
                </button>
                <button
                  className="reject"
                  disabled={busy}
                  onClick={() => review(request._id, "reject")}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty text="No pending payment requests." />
      )}
      <section className="section-heading">
        <div>
          <p className="eyebrow">GIFT CODES</p>
          <h2>Create campaign code</h2>
        </div>
      </section>
      <form className="transaction-form compact-form" onSubmit={createGift}>
        <div className="form-grid">
          <label>
            Code
            <input name="code" required placeholder="WELCOME2026" />
          </label>
          <label>
            Amount
            <input name="amount" type="number" min="1" required />
          </label>
          <label>
            Bucket
            <select name="bucket">
              <option value="bonus">Bonus</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <label>
            Max uses
            <input
              name="maxUses"
              type="number"
              min="1"
              defaultValue="1"
              required
            />
          </label>
          <label>
            Expiry <span className="optional">optional</span>
            <input name="expiresAt" type="date" />
          </label>
          <label>
            Note <span className="optional">optional</span>
            <input name="note" />
          </label>
        </div>
        <button className="outline wide" disabled={busy}>
          Create gift code
        </button>
      </form>
      {codes.length ? (
        <div className="request-list code-list">
          {codes.slice(0, 8).map((code) => (
            <div key={code._id}>
              <span className={`status ${code.active ? "active" : "closed"}`}>
                {code.active ? "active" : "closed"}
              </span>
              <strong>
                {code.code} · {inr(code.amount)}
              </strong>
              <small>
                {code.usedCount}/{code.maxUses} uses · expires{" "}
                {shortDate(code.expiresAt)}
              </small>
            </div>
          ))}
        </div>
      ) : null}
      <section className="section-heading">
        <div>
          <p className="eyebrow">RECENT ACCOUNTS</p>
          <h2>Players</h2>
        </div>
      </section>
      <div className="admin-list users">
        {users.slice(0, 15).map((person) => (
          <article key={person.id}>
            <div className="user-line">
              <span className="avatar small">
                {person.name?.slice(0, 1) || "P"}
              </span>
              <div>
                <h3>{person.name}</h3>
                <p>
                  {person.email || person.phone} · {person.role}
                </p>
              </div>
            </div>
            <div>
              <strong>{inr(person.wallet?.total)}</strong>
              <small className={`status ${person.status}`}>
                {person.status}
              </small>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function ManagerPage() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/manager/dashboard")
      .then(setData)
      .catch((error) => setMessage(error.message));
  }, []);
  if (!data && !message)
    return (
      <div className="loading-screen">
        <Spinner />
      </div>
    );
  return (
    <>
      <PageHeader title="Manager workspace" />
      <Message error>{message}</Message>
      {data ? (
        <>
          <div className="admin-stats">
            <article>
              <span>Members</span>
              <strong>{data.totals?.members}</strong>
            </article>
            <article>
              <span>Deposits</span>
              <strong>{inr(data.totals?.deposits)}</strong>
            </article>
            <article>
              <span>Wagers</span>
              <strong>{inr(data.totals?.wagered)}</strong>
            </article>
            <article>
              <span>Commissions</span>
              <strong>{inr(data.totals?.commissions)}</strong>
            </article>
          </div>
          <section className="section-heading">
            <div>
              <p className="eyebrow">MEMBER LIST</p>
              <h2>Your team</h2>
            </div>
          </section>
          {data.members?.length ? (
            <div className="admin-list users">
              {data.members.map((member) => (
                <article key={member._id}>
                  <div className="user-line">
                    <span className="avatar small">
                      {member.name?.slice(0, 1) || "P"}
                    </span>
                    <div>
                      <h3>{member.name}</h3>
                      <p>{member.phone || member.email}</p>
                    </div>
                  </div>
                  <div>
                    <strong>{inr(member.wallet?.cash)}</strong>
                    <small className={`status ${member.status}`}>
                      {member.status}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <Empty text="No team members yet." />
          )}
        </>
      ) : null}
    </>
  );
}

function LegacyGameRedirect({ prefix }) {
  const { minutes } = useParams();
  return <Navigate to={`/games/${prefix}-${minutes || 1}m`} replace />;
}
function LegacyRedirect({ to }) {
  return <Navigate to={to} replace />;
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<AuthPage register />} />
          <Route path="/forgot" element={<ForgotPasswordPage />} />
          <Route element={<Protected />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/games" element={<GamePage />} />
              <Route path="/games/:game" element={<GamePage />} />
              <Route path="/wallet" element={<WalletPage />} />
              <Route path="/rewards" element={<RewardsPage />} />
              <Route path="/team" element={<TeamPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/salary" element={<SalaryPage />} />
              <Route path="/support" element={<SupportPage />} />
              <Route element={<AgentProtected />}>
                <Route path="/manager" element={<ManagerPage />} />
              </Route>
              <Route element={<StaffProtected />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
              <Route path="/home" element={<LegacyRedirect to="/" />} />
              <Route
                path="/wingo"
                element={<LegacyRedirect to="/games/wingo-1m" />}
              />
              <Route
                path="/win/:minutes"
                element={<LegacyGameRedirect prefix="wingo" />}
              />
              <Route
                path="/trx_wingo"
                element={<LegacyRedirect to="/games/trx-wingo-1m" />}
              />
              <Route
                path="/trx_wingo/:minutes"
                element={<LegacyGameRedirect prefix="trx-wingo" />}
              />
              <Route
                path="/k3"
                element={<LegacyRedirect to="/games/k3-1m" />}
              />
              <Route
                path="/k3/:minutes"
                element={<LegacyGameRedirect prefix="k3" />}
              />
              <Route
                path="/5d"
                element={<LegacyRedirect to="/games/five-d-1m" />}
              />
              <Route
                path="/5d/:minutes"
                element={<LegacyGameRedirect prefix="five-d" />}
              />
              <Route
                path="/aviator"
                element={<LegacyRedirect to="/games/aviator" />}
              />
              <Route
                path="/jili/*"
                element={<LegacyRedirect to="/games/jili-slots" />}
              />
              <Route
                path="/jdb/*"
                element={<LegacyRedirect to="/games/jdb-games" />}
              />
              <Route
                path="/promotion/*"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/promotion1"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/activity"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/dailytask/*"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/checkIn"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/attendance/*"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/invibonus/*"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/first_deposit_bonus"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route path="/vip" element={<LegacyRedirect to="/rewards" />} />
              <Route
                path="/rebate"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/redenvelopes"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/newGift"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/dailyCheck"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route
                path="/invitation_rules"
                element={<LegacyRedirect to="/rewards" />}
              />
              <Route path="/agent" element={<LegacyRedirect to="/team" />} />
              <Route
                path="/wallet/*"
                element={<LegacyRedirect to="/wallet" />}
              />
              <Route
                path="/game_history"
                element={<LegacyRedirect to="/history" />}
              />
              <Route
                path="/mian/*"
                element={<LegacyRedirect to="/profile" />}
              />
              <Route
                path="/settings/*"
                element={<LegacyRedirect to="/profile" />}
              />
              <Route
                path="/myProfile"
                element={<LegacyRedirect to="/profile" />}
              />
              <Route
                path="/recordsalary"
                element={<LegacyRedirect to="/salary" />}
              />
              <Route
                path="/getrecord"
                element={<LegacyRedirect to="/salary" />}
              />
              <Route
                path="/feedback"
                element={<LegacyRedirect to="/support" />}
              />
              <Route
                path="/notification"
                element={<LegacyRedirect to="/support" />}
              />
              <Route
                path="/login_notification"
                element={<LegacyRedirect to="/support" />}
              />
              <Route path="/guide" element={<LegacyRedirect to="/support" />} />
              <Route
                path="/newtutorial"
                element={<LegacyRedirect to="/support" />}
              />
              <Route
                path="/manager/*"
                element={<LegacyRedirect to="/manager" />}
              />
              <Route
                path="/admin/manager/*"
                element={<LegacyRedirect to="/admin" />}
              />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
