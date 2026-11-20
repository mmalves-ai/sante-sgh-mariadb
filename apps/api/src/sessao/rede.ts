// Resolvedor da rede pelo endereço de acesso (ARQ-2, ADR 0011; ficha do M05 §1). A rede NUNCA vem de dado
// do cliente (corpo, parâmetro, cabeçalho próprio): só do Host com que a requisição chegou. Fontes, em
// ordem: o cadastro explícito `REDE_ENDERECOS` (host=rede; o deploy implementa a mesma interface com o
// cadastro de redes, DP-49), o subdomínio de `DOMINIO_BASE` (<rede>.<domínio-base>) e, só em dev/ci, o
// loopback (localhost, 127.0.0.1, ::1) e os endereços próprios da máquina de dev listados em `DEV_ENDERECOS`
// (regra do dono, 23/10/2026: o dev também atende na porta externa da VM) = REDE_PADRAO. Endereço desconhecido: null (a API recusa), em
// qualquer ambiente — nunca "cai" na rede padrão.
import { FORMATO_REDE, lerRedePadrao, type Ambiente } from '@sgh/legado';

export interface ResolvedorRede {
  /** Código da rede do endereço; null quando o endereço não pertence a nenhuma rede conhecida. */
  resolver(host: string | undefined): string | null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);
const AMBIENTES_LOOPBACK = new Set(['dev', 'ci']);

/** Nome do host sem porta, em minúsculas ("[::1]:3300" → "::1"; "Exemplo:80" → "exemplo"). */
export function nomeDoHost(host: string | undefined): string | null {
  const h = (host ?? '').trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith('[')) {
    const fim = h.indexOf(']');
    return fim > 1 ? h.slice(1, fim) : null;
  }
  const i = h.lastIndexOf(':');
  // Mais de um ":" sem colchetes é IPv6 sem porta.
  if (i !== -1 && h.indexOf(':') === i) return h.slice(0, i) || null;
  return h;
}

function lerEnderecos(valor: string | undefined): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const par of (valor ?? '').split(/[;,]/)) {
    const [host, rede] = par.split('=').map((x) => x?.trim().toLowerCase() ?? '');
    if (!host || !rede) continue;
    if (!FORMATO_REDE.test(rede)) throw new Error(`REDE_ENDERECOS: código de rede inválido para ${host}.`);
    mapa.set(host, rede);
  }
  return mapa;
}

export class ResolvedorRedeConfigurado implements ResolvedorRede {
  private readonly enderecos: Map<string, string>;
  private readonly dominioBase: string | null;
  private readonly padraoLoopback: string | null;
  private readonly locais: Set<string>;

  constructor(env: Ambiente) {
    this.enderecos = lerEnderecos(env['REDE_ENDERECOS']);
    this.dominioBase = env['DOMINIO_BASE']?.trim().toLowerCase().replace(/^\./, '') || null;
    const ambiente = env['AMBIENTE']?.trim() ?? '';
    this.padraoLoopback = AMBIENTES_LOOPBACK.has(ambiente) ? (lerRedePadrao(env) ?? null) : null;
    // Só vale junto com o loopback (dev/ci): em produção a lista é ignorada.
    this.locais = new Set(
      (env['DEV_ENDERECOS'] ?? '')
        .split(/[;,\s]+/)
        .map((x) => nomeDoHost(x))
        .filter((x): x is string => !!x),
    );
  }

  resolver(host: string | undefined): string | null {
    const nome = nomeDoHost(host);
    if (!nome) return null;
    const cadastrada = this.enderecos.get(nome);
    if (cadastrada) return cadastrada;
    if (this.dominioBase && nome.endsWith(`.${this.dominioBase}`)) {
      const rotulo = nome.slice(0, -(this.dominioBase.length + 1));
      if (FORMATO_REDE.test(rotulo)) return rotulo;
    }
    if (this.padraoLoopback && (LOOPBACK.has(nome) || this.locais.has(nome))) return this.padraoLoopback;
    return null;
  }
}
