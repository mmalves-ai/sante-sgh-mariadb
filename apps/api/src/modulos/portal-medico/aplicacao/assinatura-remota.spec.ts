// W0-10 (M6): a fila de assinatura remota do portal do médico externo, de ponta a ponta sobre o serviço REAL da
// assinatura dos documentos (M49, etapa 2) com a porta em memória e o SIMULADOR do provedor em nuvem, da ACT e da LCR:
// a fila é a do login do profissional ligado à conta (nunca da tela), só o certificado em nuvem assina, o provedor
// devolve à tela do portal (o redirect_uri próprio, o mesmo na troca do código), o lote assina numa autorização só, o
// documento de outro autor é recusado, o state vale uma vez e não serve a outra conta, e a liberação desligada aparece
// com o motivo. Certificados, CPF e documentos SINTÉTICOS; nenhum dado de pessoa.
import { PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA } from '@sgh/contratos';
import { CPF_SINTETICO_SESSAO } from '@sgh/dominio-documento';
import type { DocumentoSghLido } from '@sgh/legado';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import {
  type ArmazemPdfIcp,
  type FonteConteudoIcp,
  ServicoAssinaturaDocumentos,
} from '../../assinatura/aplicacao/documentos.js';
import { ServicoAssinaturaIcp } from '../../assinatura/aplicacao/servico.js';
import { configAssinaturaDoAmbiente } from '../../assinatura/infra/ambiente.js';
import { ROTA_NAVEGADOR_SIMULADOR, type SimuladorIcp } from '../../assinatura/infra/simulador.js';
import { PortaAssinaturaMemoria } from '../../assinatura/porta-memoria.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { PortaCirurgia } from '../../cirurgia/public-api.js';
import type { ServicoRepasse } from '../../repasse/public-api.js';
import type { PortaSadt, ServicoPortal } from '../../sadt/public-api.js';
import { PortaPortalMedicoMemoria } from '../porta-memoria.js';
import { retornoDoPortalMedico } from './assinatura-remota.js';
import { type SessaoPortalM26, ServicoPortalMedico } from './servico.js';

const H = 'pc';
const REDE = 'rede-sintetica';
const LOGIN = 'CIRURGIAO.SINTETICO';
const ACESSO = 71;
const OUTRA = 72;

function pdfMinimo(texto: string): Uint8Array {
  const conteudo = `BT /F1 8 Tf 20 800 Td (${texto.replace(/[^\x20-\x7E]/g, '?').replace(/[()\\]/g, '')}) Tj ET`;
  const objs = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>',
    `<</Length ${conteudo.length}>>\nstream\n${conteudo}\nendstream`,
    '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
  ];
  let s = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = s.length;
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f\r\n`;
  for (const o of offs) s += `${String(o).padStart(10, '0')} 00000 n\r\n`;
  s += `trailer\n<</Size ${objs.length + 1} /Root 1 0 R /ID [<AA> <AA>]>>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(s, 'latin1'));
}

class ArmazemMemoria implements ArmazemPdfIcp {
  private readonly objetos = new Map<string, Uint8Array>();
  private n = 0;
  async emitirPrevia(p: Parameters<ArmazemPdfIcp['emitirPrevia']>[0]) {
    const chave = `${p.rede}/${p.estabelecimento}/documentos/${p.modelo}/${++this.n}/via-1.pdf`;
    const pdf = pdfMinimo(`${p.titulo} QR ${p.qr.url}`);
    this.objetos.set(`${chave}@v1`, pdf);
    return { chave, versao: 'v1', pdf };
  }
  async ler(chave: string, versao: string) {
    const b = this.objetos.get(`${chave}@${versao}`);
    if (!b) throw new Error('objeto ausente');
    return b;
  }
  async gravarAssinado(rede: string, estab: string, assinatura: number, pdf: Uint8Array) {
    const chave = `${rede}/${estab}/documentos/assinados/${assinatura}/x.pdf`;
    this.objetos.set(`${chave}@v1`, pdf);
    return { chave, versao: 'v1' };
  }
}

const fonte: FonteConteudoIcp = {
  async conteudo() {
    return {
      modelo: 'atestado',
      titulo: 'Atestado médico',
      profissional: 'Profissional Sintético',
      conteudo: {
        modelo: 'atestado',
        identificacao: {
          paciente: 'Paciente Sintético',
          prontuario: '1001',
          nascimento: null,
          atendimento: null,
          profissional: 'Profissional Sintético',
          conselho: null,
          dataHora: '24/10/2026 09:00',
        },
        corpo: ['Atesto SINTETICO.'],
      },
    };
  },
  async nomes(_c, ps) {
    return new Map(ps.map((p) => [p, `Paciente ${p}`]));
  },
};

const documento = (
  id: number,
  o: Partial<DocumentoSghLido> = {},
): DocumentoSghLido & { eventos: string[] } => ({
  id,
  tipo: 'atestado',
  origemTabela: 'PRATESTREQIMP',
  origemId: 9000 + id,
  paciente: 1001,
  atendimento: null,
  usuario: LOGIN,
  hash: 'd'.repeat(64),
  nivel: 'eletronica-simples',
  criadoEm: '2026-10-24T09:00:00.000Z',
  assinadoEm: null,
  suspenso: false,
  comoSuporte: false,
  eventos: ['emitido'],
  ...o,
});

/** A sessão interna do próprio profissional (no hospital), para vincular o certificado em nuvem. */
const interna = (login = LOGIN): SessaoCadastro => ({
  req: { headers: {}, ip: '127.0.0.1' } as unknown as RequisicaoAutorizada,
  hospital: H,
  rede: REDE,
  login,
  porta: { rede: REDE, hospital: H },
  pode: () => false,
});

const sessao = (acesso = ACESSO) =>
  ({ hospital: H, perfil: 'medicoExterno', acesso, nome: 'M' }) as unknown as SessaoPortalM26;

let docs: (DocumentoSghLido & { eventos: string[] })[];
let assinaturaPorta: PortaAssinaturaMemoria;
let sim: SimuladorIcp;
let icp: ServicoAssinaturaIcp;
let ligadas: Set<string>;
let portal: ServicoPortalMedico;
let portaPortal: PortaPortalMedicoMemoria;

beforeEach(async () => {
  docs = [documento(1), documento(2), documento(3, { usuario: 'OUTRO.MEDICO' })];
  assinaturaPorta = new PortaAssinaturaMemoria({
    todos: () => docs,
    marcarAssinadoIcp: (_h, id) => {
      const d = docs.find((x) => x.id === id)!;
      Object.assign(d, {
        assinadoEm: new Date().toISOString(),
        nivel: 'icp-brasil',
        eventos: [...d.eventos, 'assinado'],
      });
    },
  });
  const cfg = await configAssinaturaDoAmbiente({}, true, null, process.cwd());
  sim = cfg.simulador!;
  icp = new ServicoAssinaturaIcp(assinaturaPorta, new RegistradorTrilhaMemoria(), cfg);
  ligadas = new Set(['assinatura.icp']);
  const documentos = new ServicoAssinaturaDocumentos(
    icp,
    assinaturaPorta,
    fonte,
    new ArmazemMemoria(),
    {
      consultar: async (_s, chave) => ({
        ligada: ligadas.has(chave),
        motivo: ligadas.has(chave) ? null : `A funcionalidade ${chave} ainda não foi liberada.`,
      }),
    },
    { urlVerificador: 'https://portal.exemplo.invalid' },
  );
  const situacoes = new Map<number, string>([
    [ACESSO, 'ativo'],
    [OUTRA, 'ativo'],
  ]);
  const sadt = {
    destino: 'memoria',
    acessoPorId: async (_c: unknown, id: number) =>
      situacoes.has(id) ? { id, perfil: 'medicoExterno', situacao: situacoes.get(id) } : null,
  } as unknown as PortaSadt;
  portaPortal = new PortaPortalMedicoMemoria(async (_c, a) => situacoes.get(a) ?? null);
  portal = new ServicoPortalMedico(
    { sair: () => undefined } as unknown as ServicoPortal,
    sadt,
    portaPortal,
    {} as PortaCirurgia,
    {} as ServicoRepasse,
    null,
    REDE,
  );
  portal.assinatura = {
    retorno: retornoDoPortalMedico(cfg.retorno),
    fila: (x) => documentos.fila(x),
    prepararLote: (x, e) => documentos.prepararLote(x, e),
    pedir: (x, e, r) => documentos.pedir(x, e, r),
    concluir: (x, q, r) => icp.retornoPsc(x, q, r),
  };
});

async function ligar(acesso: number, profissional: number) {
  await portaPortal.gravar(
    { rede: REDE, hospital: H },
    (g) => g.vincular({ acesso, profissional, por: 'T' }),
    null,
  );
}

/** A página do provedor simulado confirma: devolve o que a tela do portal recebe na URL de volta. */
function autorizar(endereco: string, cpf = CPF_SINTETICO_SESSAO) {
  expect(endereco.startsWith(`${ROTA_NAVEGADOR_SIMULADOR}/oauth/authorize?`)).toBe(true);
  const q = Object.fromEntries(new URL(endereco, 'http://x').searchParams);
  expect(q['redirect_uri']).toBe(PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA);
  const volta = new URL(sim.autorizar(q, cpf), 'http://x');
  expect(volta.pathname).toBe(PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA);
  return { state: volta.searchParams.get('state')!, code: volta.searchParams.get('code'), erro: null };
}

async function vincularNuvem(): Promise<number> {
  const a = await icp.iniciarVinculoNuvem(interna(), 'simulador');
  const q = Object.fromEntries(new URL(a.endereco, 'http://x').searchParams);
  const volta = new URL(sim.autorizar(q, CPF_SINTETICO_SESSAO), 'http://x').searchParams;
  const r = await icp.retornoPsc(interna(), {
    state: volta.get('state')!,
    code: volta.get('code'),
    erro: null,
  });
  expect(r.ok).toBe(true);
  return r.certificado!;
}

async function erro(p: Promise<unknown>): Promise<[number, string | undefined]> {
  try {
    await p;
  } catch (e) {
    const x = e as { getStatus(): number; extras?: { codigo?: string } };
    return [x.getStatus(), x.extras?.codigo];
  }
  throw new Error('Era para ser recusada.');
}

describe('W0-10 (M6): fila de assinatura remota no portal do médico externo', () => {
  it('sem vínculo ou sem login do profissional, a fila vem vazia e diz por quê', async () => {
    expect(await portal.assinaturas(sessao(), null)).toMatchObject({ vinculado: false, comLogin: false });
    await ligar(ACESSO, 6802); // a outra médica sintética não tem login no sistema
    expect(await portal.assinaturas(sessao(), null)).toMatchObject({
      vinculado: true,
      comLogin: false,
      documentos: [],
    });
    expect(await erro(portal.assinar(sessao(), null, { documentos: [1] }))).toEqual([
      409,
      'sem-login-do-profissional',
    ]);
  });

  it('a fila é a do login do profissional ligado (o documento de outro autor fica fora); sem certificado em nuvem, assinar recusa', async () => {
    await ligar(ACESSO, 6801);
    const f = await portal.assinaturas(sessao(), null, '10.0.0.9');
    expect(f).toMatchObject({ vinculado: true, comLogin: true, ligada: true, certificado: null });
    expect(f.documentos.map((d) => d.documento).sort()).toEqual([1, 2]);
    expect(f.documentos[0]).toMatchObject({ situacao: 'a-assinar', nome: 'Paciente 1001' });
    expect(f.documentos[0]!.exigencia.nivel).toBe('icp-brasil');
    expect(portaPortal.trilhas.at(-1)).toMatchObject({
      evento: 'portal.medico.assinaturasLidas',
      usuario: `SGH.PORTAL.M${ACESSO}`,
    });
    expect(await erro(portal.assinar(sessao(), null, { documentos: [1] }))).toEqual([
      409,
      'sem-certificado-nuvem',
    ]);
  });

  it('assina o lote com o certificado em nuvem: o provedor volta à tela do portal; o de outro autor é recusado; o state vale uma vez', async () => {
    await ligar(ACESSO, 6801);
    const cert = await vincularNuvem();
    expect((await portal.assinaturas(sessao(), null)).certificado).toMatchObject({
      id: cert,
      midia: 'nuvem',
    });
    const inicio = await portal.assinar(sessao(), null, { documentos: [1, 2, 3] }, '10.0.0.9');
    expect(inicio.recusados).toEqual([{ documento: 3, motivo: 'nao-e-o-autor' }]);
    expect(inicio.endereco).not.toBeNull();
    expect(portaPortal.trilhas.at(-1)).toMatchObject({
      evento: 'portal.medico.assinaturaPedida',
      resultado: 'sucesso',
    });
    const volta = autorizar(inicio.endereco!);
    const r = await portal.concluirAssinatura(sessao(), null, volta);
    expect(r).toEqual({ ok: true, motivo: null, assinados: 2, pendentes: 0, recusados: 0 });
    expect(docs.filter((d) => d.eventos.includes('assinado')).map((d) => d.id)).toEqual([1, 2]);
    expect(portaPortal.trilhas.at(-1)).toMatchObject({
      evento: 'portal.medico.assinaturaConcluida',
      resultado: 'sucesso',
    });
    // A trilha do M49 leva o login do profissional e a correlação da conta do portal.
    const doM49 = assinaturaPorta.trilhas.filter(
      (t) => t.correlacao === `portal-medico-M${ACESSO}-assinatura`,
    );
    expect(doM49.length).toBeGreaterThan(0);
    expect(doM49.every((t) => t.usuario === LOGIN)).toBe(true);
    // A mesma volta de novo: o pedido já foi consumido.
    expect(await portal.concluirAssinatura(sessao(), null, volta)).toMatchObject({
      ok: false,
      motivo: 'autorizacao-expirada',
    });
    expect((await portal.assinaturas(sessao(), null)).documentos).toEqual([]);
  });

  it('a volta de uma conta não serve a outra (o pedido é do login e do estabelecimento de quem pediu)', async () => {
    await ligar(ACESSO, 6801);
    portaPortal.loginsDoProfissional.set(6802, 'OUTRO.MEDICO');
    await ligar(OUTRA, 6802);
    await vincularNuvem();
    const inicio = await portal.assinar(sessao(), null, { documentos: [1] });
    const volta = autorizar(inicio.endereco!);
    expect(await portal.concluirAssinatura(sessao(OUTRA), null, volta)).toMatchObject({
      ok: false,
      assinados: 0,
    });
    expect(docs.find((d) => d.id === 1)!.eventos).not.toContain('assinado');
  });

  it('com a assinatura ICP desligada no estabelecimento (parâmetro), a fila diz o motivo e nada se assina', async () => {
    await ligar(ACESSO, 6801);
    ligadas.clear();
    const f = await portal.assinaturas(sessao(), null);
    expect(f.ligada).toBe(false);
    expect(f.motivoDesligada).toMatch(/assinatura\.icp/);
    await vincularNuvem();
    expect((await erro(portal.assinar(sessao(), null, { documentos: [1] })))[0]).toBe(403);
  });

  it('o redirect_uri do portal é o caminho da tela no mesmo endereço do retorno interno', () => {
    expect(retornoDoPortalMedico('/api/documento/assinatura/retorno')).toBe(
      PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA,
    );
    expect(retornoDoPortalMedico('https://sgh.exemplo.invalid/api/documento/assinatura/retorno')).toBe(
      `https://sgh.exemplo.invalid${PORTAL_MEDICO_ROTA_RETORNO_ASSINATURA}`,
    );
  });
});
