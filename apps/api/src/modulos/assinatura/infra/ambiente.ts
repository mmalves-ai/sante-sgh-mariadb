// Configuração do serviço de assinatura pelo ambiente (M49, etapa 1; critério "ambiente:verificar: PSC, ACT e Atesta
// CFM no simulador ou desligados"):
//   - ASSINATURA_ICP_MODO = simulador | producao | desligado. Em dev/ci o padrão é `simulador` e `producao` é recusado
//     (a partida cai para `desligado`); fora de dev/ci o padrão é `desligado` e `simulador` é recusado.
//   - produção: ICP_RAIZES_DIR (as raízes ICP-Brasil do repositório do ITI, .cer/.crt/.pem), ICP_INTERMEDIARIAS_DIR
//     (opcional), ASSINATURA_ACT_URL (a ACT credenciada, https), ASSINATURA_RETORNO_URL (o redirect_uri cadastrado
//     nos provedores, https) e o cofre (COFRE_DIR fora do repositório + PLATAFORMA_CHAVE_MESTRA). Faltando qualquer um,
//     o modo vira `desligado` (falha fechada) e a tela diz o que falta.
//   - ASSINATURA_AGENTE_LOCAL_URL: o endereço do agente local A1/A3 nas estações (http://127.0.0.1:porta); vazio: o
//     A1/A3 fica desligado (POL-3) até o agente ser escolhido e instalado (TI).
// O conector Atesta CFM continua desligado pelo parâmetro `documento.atestaCfm` (regra 10).
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModoAssinaturaIcp } from '@sgh/contratos';
import { CLIENT_ID_SIMULADOR, SimuladorIcp } from './simulador.js';
import type { ConfigServicoAssinatura } from '../aplicacao/servico.js';
import { buscadorLcrHttp, type ClientePsc, clienteActHttp, clientePscHttp } from './clientes.js';
import { type Cofre, CofreMemoria, cofreDoAmbiente } from './cofre.js';

type Ambiente = Readonly<Record<string, string | undefined>>;

export function modoAssinaturaIcp(env: Ambiente, sintetico: boolean): ModoAssinaturaIcp {
  const pedido = (env['ASSINATURA_ICP_MODO'] ?? '').trim();
  if (sintetico) return pedido === 'desligado' ? 'desligado' : 'simulador';
  return pedido === 'producao' ? 'producao' : 'desligado';
}

/** Lê os certificados (DER ou PEM) de um diretório; vazio quando não existe. */
export function lerCertificados(dir: string | undefined): Uint8Array[] {
  if (!dir?.trim()) return [];
  let nomes: string[];
  try {
    nomes = readdirSync(dir).filter((n) => /\.(cer|crt|der|pem)$/i.test(n));
  } catch {
    return [];
  }
  const r: Uint8Array[] = [];
  for (const n of nomes.sort()) {
    const b = readFileSync(join(dir, n));
    const t = b.toString('latin1');
    if (t.includes('-----BEGIN CERTIFICATE-----'))
      for (const m of t.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g))
        r.push(Uint8Array.from(Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64')));
    else r.push(Uint8Array.from(b));
  }
  return r;
}

/**
 * Monta a configuração do serviço. No simulador: o cofre em memória com o segredo do provedor simulado (gerado na
 * partida), a ICP sintética e os clientes em processo. Em produção: os clientes HTTP, as raízes do diretório e o
 * cofre de arquivo; o simulador nunca entra.
 */
export async function configAssinaturaDoAmbiente(
  env: Ambiente,
  sintetico: boolean,
  chaveMestra: Buffer | null,
  raizRepo: string,
): Promise<ConfigServicoAssinatura> {
  let modo = modoAssinaturaIcp(env, sintetico);
  const agenteLocal = env['ASSINATURA_AGENTE_LOCAL_URL']
    ?.trim()
    .match(/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}\/?$/)
    ? env['ASSINATURA_AGENTE_LOCAL_URL']!.trim()
    : null;
  if (modo === 'simulador') {
    const cofre: Cofre = new CofreMemoria();
    // O segredo do simulador nasce na partida; o serviço o grava na referência de cada estabelecimento
    // (cofre:psc/<estab>/simulador/client-secret) quando cria o provedor simulado dele.
    const segredo = randomBytes(24).toString('base64url');
    const sim = new SimuladorIcp(async () => segredo);
    // Provedor simulado pelo client_id; qualquer outro provedor cadastrado na sessão de teste vai pelo HTTP de verdade.
    const psc: ClientePsc = {
      trocarCodigo: (c, p) =>
        (c.clientId === CLIENT_ID_SIMULADOR ? sim.psc : clientePscHttp).trocarCodigo(c, p),
      descobrirCertificados: (c, t) =>
        (c.clientId === CLIENT_ID_SIMULADOR ? sim.psc : clientePscHttp).descobrirCertificados(c, t),
      assinar: (c, t, i, a) =>
        (c.clientId === CLIENT_ID_SIMULADOR ? sim.psc : clientePscHttp).assinar(c, t, i, a),
      testar: (c) => (c.clientId === CLIENT_ID_SIMULADOR ? sim.psc : clientePscHttp).testar(c),
    };
    return {
      modo,
      cofre,
      psc,
      act: sim.carimbo,
      lcr: sim.lcr,
      raizes: () => sim.raizes(),
      intermediarios: () => [],
      retorno: '/api/documento/assinatura/retorno',
      simulador: sim,
      agenteLocal,
    };
  }
  const cofre = cofreDoAmbiente(env, chaveMestra, raizRepo);
  const raizes = lerCertificados(env['ICP_RAIZES_DIR']);
  const intermediarias = lerCertificados(env['ICP_INTERMEDIARIAS_DIR']);
  const act = env['ASSINATURA_ACT_URL']?.trim() ?? '';
  const retorno = env['ASSINATURA_RETORNO_URL']?.trim() ?? '';
  if (
    modo === 'producao' &&
    (!cofre.disponivel || raizes.length === 0 || !/^https:\/\//.test(act) || !/^https:\/\//.test(retorno))
  )
    modo = 'desligado';
  return {
    modo,
    cofre,
    psc: clientePscHttp,
    act: /^https:\/\//.test(act) ? clienteActHttp(act) : null,
    lcr: buscadorLcrHttp(),
    raizes: () => raizes,
    intermediarios: () => intermediarias,
    retorno,
    simulador: null,
    agenteLocal,
  };
}
