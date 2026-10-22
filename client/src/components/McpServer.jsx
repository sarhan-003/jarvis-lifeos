// The Jarvis LifeOS MCP server as a brand integration: endpoint, protocol,
// tools (discovered live over MCP) and how an Alexa+-style agent connects.
import { useEffect, useState } from 'react';
import { api } from '../api.js';

const HINTS = [
  ['readOnlyHint', 'read-only'],
  ['destructiveHint', 'destructive'],
  ['idempotentHint', 'idempotent'],
];

export default function McpServerView() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .mcp()
      .then(setInfo)
      .catch((err) => setError(err.message));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.endpoint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the URL is still visible to copy by hand */
    }
  };

  if (error) return <div className="alert" role="alert">{error}</div>;
  if (!info) return <section className="panel"><p className="empty-small">Discovering tools over MCP…</p></section>;

  return (
    <div className="mcp-view">
      <section className="panel mcp-hero">
        <div className="panel-head">
          <h2>Jarvis LifeOS MCP server</h2>
          <span className="badge badge-ok">Online</span>
        </div>
        <p className="dim">
          MCP is the open standard that powers Alexa+ integrations. Jarvis LifeOS exposes its study and task tools as a self-hosted MCP server, and the
          simulator on the Assistant page uses it exactly as an Alexa+ agent would: <code>tools/list</code> to discover, <code>tools/call</code> to act.
        </p>
        <div className="mcp-facts">
          <div>
            <span className="dim small">Endpoint</span>
            <div className="endpoint">
              <code>{info.endpoint}</code>
              <button className="btn btn-ghost" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div>
            <span className="dim small">Protocol</span>
            <div>
              <code>{info.protocolVersion}</code>
            </div>
          </div>
          <div>
            <span className="dim small">Transport</span>
            <div>Streamable HTTP, sessions</div>
          </div>
          <div>
            <span className="dim small">Auth</span>
            <div>{info.auth ? 'Bearer token required' : 'Local only (set MCP_AUTH_TOKEN to expose)'}</div>
          </div>
          <div>
            <span className="dim small">Tool calls over MCP</span>
            <div>{info.mcpCalls}</div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Tools ({info.tools.length})</h2>
          <span className="dim small">Live result of tools/list</span>
        </div>
        <ul className="mcp-tools">
          {info.tools.map((t) => (
            <li key={t.name}>
              <div className="mcp-tool-head">
                <code className="tool-name">{t.name}</code>
                {HINTS.filter(([k]) => t.annotations?.[k]).map(([k, label]) => (
                  <span key={k} className={`badge ${k === 'destructiveHint' ? 'badge-warn' : 'badge-muted'}`}>
                    {label}
                  </span>
                ))}
              </div>
              <p className="small dim">{t.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Connect an MCP client</h2>
        </div>
        <ol className="small mcp-steps">
          <li>
            Run <code>npx @modelcontextprotocol/inspector</code>, choose <b>Streamable HTTP</b> and enter <code>{info.endpoint}</code>.
          </li>
          <li>
            Call <code>createTask</code> with <code>{'{"title":"Revise heaps","dueDate":"tomorrow"}'}</code> and watch it appear on the Tasks page and in Activity as “MCP client”.
          </li>
          <li>Destructive tools ask for confirmation through MCP elicitation when the client supports it.</li>
        </ol>
      </section>
    </div>
  );
}
