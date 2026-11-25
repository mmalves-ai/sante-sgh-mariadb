// Vínculo da conta ao estabelecimento (01-ADM L59): dar acesso a este estabelecimento a uma conta que já existe no
// cliente e encerrar esse acesso. A senha vai só com o pedido (reautenticação) e nunca é guardada.
import { tokenCsrf } from '../../api.js';
import { erroDaResposta } from '../../casca/erros/problem-details.js';

const A = '/api/administracao/acesso';

function chaveIdempotencia(): string {
  try {
    return `web-${crypto.randomUUID()}`;
  } catch {
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

async function gravar(url: string, corpo: unknown): Promise<{ operacao: string }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-csrf': tokenCsrf(),
      'idempotency-key': chaveIdempotencia(),
    },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw await erroDaResposta(r);
  return (await r.json()) as { operacao: string };
}

export const vincularConta = (login: string, grupo: string, senha: string) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/vinculo`, { grupo, senha });
export const encerrarVinculo = (login: string, senha: string) =>
  gravar(`${A}/usuarios/${encodeURIComponent(login)}/vinculo/encerrar`, { senha });
