// Assinatura ICP-Brasil dos documentos emitidos, etapa 2 (regras 2, 4, 5, 6, 7, 8, 10 e 12), de ponta a ponta sobre a
// porta em memória, o SIMULADOR do provedor, da ACT e da LCR e um armazém de PDF em memória: a fila do autor pela
// política (atestado que sai do hospital: ICP AD-RT; registro clínico: avançada, fora da fila), a prévia exata com o
// selo e o QR, o pedido com a prévia (hash divergente, documento sem prova, outro autor, sessão "como" e liberação
// desligada recusados), o lote de 20 numa autorização só, o CPF divergente recusado, o PDF assinado validável (CMS
// destacado com o carimbo, conferido de novo aqui), a ACT fora do ar deixando pendente com os avisos ao autor e à
// direção técnica, o reprocessamento à mão e pelo agendador, a falha depois das tentativas, o A1/A3 pelo agente local
// e a numeração SNCR desligada pela chave. Certificados, CPF e documentos SINTÉTICOS; nenhum dado de pessoa.
import { createHash } from 'node:crypto';
import {
  assinarHashRsa,
  CPF_SINTETICO_OUTRO,
  CPF_SINTETICO_SESSAO,
  conferirAssinaturaHash,
  lerAssinaturaPdf,
  lerCms,
  TIPOS_ASSINAVEIS_ICP,
} from '@sgh/dominio-documento';
import { type DocumentoEmitidoIcp, TIPOS_DOCUMENTO_ICP } from '../tipos.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import {
  AssinaturaDocumentosController,
  redeDoAgendador,
  reprocessamentoLigado,
  sessaoDoAgendador,
} from '../assinatura-documentos.controller.js';
import { configAssinaturaDoAmbiente } from '../infra/ambiente.js';
import { configDocumentosIcpDoAmbiente, politicaDoAmbiente } from '../infra/documentos-ambiente.js';
import { ROTA_NAVEGADOR_SIMULADOR, type SimuladorIcp } from '../infra/simulador.js';
import { SimuladorSncr } from '../infra/simulador-sncr.js';
import { PortaAssinaturaMemoria } from '../porta-memoria.js';
import {
  type ArmazemPdfIcp,
  type FonteConteudoIcp,
  ServicoAssinaturaDocumentos,
  USUARIO_REPROCESSAMENTO,
} from './documentos.js';
import { type ConfigServicoAssinatura, ServicoAssinaturaIcp } from './servico.js';

const LOGIN = 'MEDICO.SINTETICO';

function sessao(o: { login?: string; como?: boolean; pode?: (c: string) => boolean } = {}): SessaoCadastro {
  const req = {
    headers: {},
    ip: '127.0.0.1',
    ...(o.como ? { sghComo: { alvoNome: 'Alvo sintético' } } : {}),
  } as unknown as RequisicaoAutorizada;
  return {
    req,
    hospital: 'pc',
    rede: 'rede-sintetica',
    login: o.login ?? LOGIN,
    porta: { rede: 'rede-sintetica', hospital: 'pc', cliente: 'teste', estabelecimento: 1, usuario: 1, correlacao: 'teste' },
    pode: o.pode ?? (() => false),
  };
}

async function recusada(p: Promise<unknown>): Promise<{ status: number; motivo: string | undefined }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema)
      return {
        status: e.getStatus(),
        motivo:
          (e.extras as { motivo?: string; codigo?: string }).motivo ??
          (e.extras as { codigo?: string }).codigo,
      };
    throw e;
  }
  throw new Error('Era para ser recusada.');
}

/** PDF mínimo com tabela xref clássica (como o do Gotenberg), com o texto dos campos na página. */
function pdfDosCampos(linhas: readonly string[]): Uint8Array {
  const texto = linhas.map((l) => l.replace(/[^\x20-\x7E]/g, '?').replace(/[()\\]/g, '')).join(' / ');
  const conteudo = `BT /F1 8 Tf 20 800 Td (${texto.slice(0, 2000)}) Tj ET`;
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
  readonly objetos = new Map<string, Uint8Array>();
  readonly textos = new Map<number, string>();
  private n = 0;
  async emitirPrevia(p: Parameters<ArmazemPdfIcp['emitirPrevia']>[0]) {
    const chave = `${p.rede}/${p.estabelecimento}/documentos/${p.modelo}/${++this.n}/via-1.pdf`;
    const linhas = [p.titulo, ...p.campos.map((c) => `${c.rotulo}: ${c.valor}`), `QR ${p.qr.url}`];
    this.textos.set(p.documento, linhas.join('\n'));
    const pdf = pdfDosCampos(linhas);
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

let docs: (DocumentoEmitidoIcp & { eventos: string[] })[];
let porta: PortaAssinaturaMemoria;
let trilha: RegistradorTrilhaMemoria;
let cfg: ConfigServicoAssinatura;
let sim: SimuladorIcp;
let icp: ServicoAssinaturaIcp;
let servico: ServicoAssinaturaDocumentos;
let armazem: ArmazemMemoria;
let ligadas: Set<string>;
let sncr: SimuladorSncr;
const s = sessao();

function documento(id: number, o: Partial<DocumentoEmitidoIcp> = {}): DocumentoEmitidoIcp & { eventos: string[] } {
  return {
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
  };
}

const fonte: FonteConteudoIcp = {
  async conteudo(_c, d) {
    return {
      modelo: d.tipo === 'receita-controlada' ? 'receita-controlada' : 'atestado',
      titulo: d.tipo === 'receita-controlada' ? 'Receituário de controle especial' : 'Atestado médico',
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
        corpo:
          d.tipo === 'receita-controlada'
            ? ['Medicamento A SINTETICO', 'Medicamento B SINTETICO']
            : ['Atesto SINTETICO.'],
      },
    };
  },
  async nomes(_c, ps) {
    return new Map(ps.map((p) => [p, `Paciente ${p}`]));
  },
};

beforeEach(async () => {
  docs = [
    documento(1),
    documento(2, { tipo: 'registro-clinico', origemTabela: 'PRCABEVOL' }),
    documento(3, { usuario: 'OUTRO.MEDICO' }),
    documento(4, { tipo: 'anexo', origemTabela: 'PRGEDIMP' }),
    documento(5, { suspenso: true }),
    documento(6, { tipo: 'receita-controlada', origemTabela: 'PRRECEITA' }),
  ];
  porta = new PortaAssinaturaMemoria({
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
  trilha = new RegistradorTrilhaMemoria();
  cfg = await configAssinaturaDoAmbiente({}, true, null, process.cwd());
  sim = cfg.simulador!;
  icp = new ServicoAssinaturaIcp(porta, trilha, cfg);
  armazem = new ArmazemMemoria();
  ligadas = new Set(['assinatura.icp']);
  sncr = new SimuladorSncr();
  servico = new ServicoAssinaturaDocumentos(
    icp,
    porta,
    fonte,
    armazem,
    {
      consultar: async (_s, chave) => ({
        ligada: ligadas.has(chave),
        motivo: ligadas.has(chave) ? null : `A funcionalidade ${chave} ainda não foi liberada.`,
      }),
    },
    { urlVerificador: 'https://portal.exemplo.invalid', sncr },
  );
});

function autorizar(endereco: string, cpf: string) {
  expect(endereco.startsWith(`${ROTA_NAVEGADOR_SIMULADOR}/oauth/authorize?`)).toBe(true);
  const q = Object.fromEntries(new URL(endereco, 'http://x').searchParams);
  const volta = new URL(sim.autorizar(q, cpf), 'http://x').searchParams;
  return { state: volta.get('state')!, code: volta.get('code'), erro: volta.get('error') };
}

async function vincular(cpf = CPF_SINTETICO_SESSAO): Promise<number> {
  const a = await icp.iniciarVinculoNuvem(s, 'simulador');
  const r = await icp.retornoPsc(s, autorizar(a.endereco, cpf));
  expect(r.ok).toBe(true);
  return r.certificado!;
}

async function assinarNuvem(ids: number[], cert: number, cpf = CPF_SINTETICO_SESSAO) {
  const lote = await servico.prepararLote(s, { documentos: ids, certificado: cert });
  const p = await servico.pedir(s, {
    documentos: lote.itens.map((x) => x.documento),
    hashes: lote.itens.map((x) => x.hash),
    certificado: cert,
  });
  if (!p.inicio || p.inicio.tipo !== 'nuvem') throw new Error(`sem início: ${JSON.stringify(p.recusados)}`);
  return { lote, pedido: p, volta: await icp.retornoPsc(s, autorizar(p.inicio.endereco, cpf)) };
}

describe('fila do autor pela política (regras 6 e 7)', () => {
  it('o atestado que sai do hospital pede ICP AD-RT; o registro clínico (avançada), o de outro autor, o anexo e o suspenso ficam fora', async () => {
    const f = await servico.fila(s);
    expect(f.liberada).toBe(true);
    expect(f.itens.map((x) => x.documento)).toEqual([6, 1]); // receita de controle especial antes do atestado
    expect(f.itens[1]).toMatchObject({
      situacao: 'a-assinar',
      titulo: 'Atestado',
      nome: 'Paciente 1001',
      exigencia: { nivel: 'icp-brasil', politicaIcp: 'AD-RT', carimboDoTempo: true, origem: 'piso-legal' },
    });
    expect(f.estabelecimento).toBeNull();
    const dt = await servico.fila(sessao({ pode: (c) => c === 'documento.assinatura.reprocessar' }));
    expect(dt.estabelecimento).toEqual({ pendentes: 0, falhas: 0, avisos: [] });
  });

  it('o teto vem depois da política: 210 registros clínicos (que não pedem ICP) não escondem o atestado novo', async () => {
    for (let i = 0; i < 210; i++)
      docs.push(documento(100 + i, { tipo: 'registro-clinico', origemTabela: 'PRCABEVOL' }));
    docs.push(documento(5000));
    const f = await servico.fila(s);
    expect(f.limitado).toBe(false);
    expect(f.itens.map((x) => x.documento)).toEqual([6, 1, 5000]);
    expect(f.itens.every((x) => x.exigencia.nivel === 'icp-brasil')).toBe(true);
  });

  it('a lista dos tipos que recebem a ICP é a mesma no motor e no SQL do adaptador', () => {
    expect([...TIPOS_DOCUMENTO_ICP]).toEqual([...TIPOS_ASSINAVEIS_ICP]);
  });
});

describe('prévia exata (regras 4 e 8)', () => {
  it('o PDF/A com o selo, o rodapé legal e o QR do verificador; o hash é o do arquivo; a prévia vai à trilha', async () => {
    const cert = await vincular();
    const p = await servico.previa(s, 1, cert);
    const { pdf } = await servico.pdfDaPrevia(s, 1);
    expect(p.hash).toBe(createHash('sha256').update(pdf).digest('hex'));
    expect(p.exigencia.politicaIcp).toBe('AD-RT');
    const texto = armazem.textos.get(1)!;
    expect(texto).toContain('Assinado digitalmente por Profissional Sintético (CRM-RJ 000000)');
    expect(texto).toContain('carimbo do tempo (AD-RT)');
    expect(texto).toContain(`QR https://portal.exemplo.invalid/verificar/${p.codigo}`);
    expect(texto).toContain('validar.iti.gov.br');
    expect(texto).not.toContain('Assinar à mão');
    expect(porta.trilhas.map((t) => t.evento)).toContain('documento.assinatura.previa');
  });

  it('recusas: documento sem prova (regra 7), outro autor, tipo sem ICP, suspenso, sessão "como"', async () => {
    const cert = await vincular();
    expect((await recusada(servico.previa(s, 999, cert))).motivo).toBe('documento-sem-prova');
    expect((await recusada(servico.previa(s, 3, cert))).motivo).toBe('nao-e-o-autor');
    expect((await recusada(servico.previa(s, 4, cert))).motivo).toBe('tipo-sem-icp');
    expect((await recusada(servico.previa(s, 5, cert))).motivo).toBe('documento-suspenso');
    expect((await recusada(servico.previa(sessao({ como: true }), 1, cert))).motivo).toBe('sessao-como');
    expect((await recusada(servico.previa(s, 1, 4242))).motivo).toBe('certificado-divergente');
  });

  it('conteúdo do documento que não se lê: recusa sem substituto; nenhuma prévia, nenhum PDF, nenhuma trilha', async () => {
    const cert = await vincular();
    const quebrada: FonteConteudoIcp = {
      ...fonte,
      conteudo: async () => {
        throw new Error('origem inacessível');
      },
    };
    const sem = new ServicoAssinaturaDocumentos(
      icp,
      porta,
      quebrada,
      armazem,
      { consultar: async () => ({ ligada: true, motivo: null }) },
      { urlVerificador: 'https://portal.exemplo.invalid' },
    );
    expect(await recusada(sem.previa(s, 1, cert))).toEqual({ status: 503, motivo: 'conteudo-indisponivel' });
    // No lote, o item é recusado com o motivo e o resto segue.
    expect(await sem.prepararLote(s, { documentos: [1], certificado: cert })).toEqual({
      itens: [],
      recusados: [{ documento: 1, motivo: 'conteudo-indisponivel' }],
    });
    expect(armazem.textos.size).toBe(0);
    expect(await porta.previaMaisRecente(s.porta, 1, LOGIN)).toBeNull();
    expect(porta.trilhas.map((t) => t.evento)).not.toContain('documento.assinatura.previa');
  });

  it('chave assinatura.icp desligada: a prévia também é recusada (nada vai ao S3); a fila mostra o motivo', async () => {
    const cert = await vincular();
    ligadas.clear();
    expect(await recusada(servico.previa(s, 1, cert))).toEqual({ status: 403, motivo: 'recurso-desligado' });
    expect(armazem.textos.size).toBe(0);
    expect((await servico.fila(s)).liberada).toBe(false);
  });
});

describe('assinar um documento e o lote (regras 1, 2, 3 e 8)', () => {
  it('atestado: prévia → provedor → assinada AD-RT; evento "assinado" ICP; PDF assinado validável; sai da fila', async () => {
    const cert = await vincular();
    const { volta, lote } = await assinarNuvem([1], cert);
    expect(volta).toMatchObject({
      finalidade: 'documento',
      ok: true,
      lote: { assinados: 1, pendentes: 0, recusados: 0 },
    });
    expect(docs[0]!.eventos).toEqual(['emitido', 'assinado']);
    expect(docs[0]!.nivel).toBe('icp-brasil');
    const f = await servico.fila(s);
    expect(f.itens.map((x) => x.documento)).toEqual([6]);
    expect(f.assinados[0]).toMatchObject({
      documento: 1,
      politicaIcp: 'AD-RT',
      codigo: lote.itens[0]!.codigo,
    });
    // O PDF assinado: o original da prévia intacto no começo, o /ByteRange cobrindo tudo, o CMS com o carimbo.
    const previa = (await servico.pdfDaPrevia(s, 1)).pdf;
    const { pdf } = await servico.pdfAssinado(s, f.assinados[0]!.assinatura);
    expect(Buffer.from(pdf.subarray(0, previa.length)).equals(Buffer.from(previa))).toBe(true);
    const l = lerAssinaturaPdf(pdf);
    expect(l.cobreTudo).toBe(true);
    const cms = lerCms(l.cms);
    expect(cms.temCarimbo).toBe(true);
    expect(Buffer.from(cms.resumo!).equals(Buffer.from(l.resumo))).toBe(true);
    const hashAtributos = createHash('sha256').update(cms.atributos).digest();
    expect(
      conferirAssinaturaHash(sim.titular(CPF_SINTETICO_SESSAO).certificado, hashAtributos, cms.assinatura),
    ).toBe(true);
    // A exportação valida de novo (momento "exportar"): válida (o CPF já foi conferido na assinatura) e vai à trilha.
    expect(porta.trilhas.find((t) => t.evento === 'documento.assinatura.exportado')?.chave).toBe(
      'exportar:valida',
    );
    expect(porta.trilhas.map((t) => t.evento)).toEqual(
      expect.arrayContaining([
        'documento.assinatura.pedida',
        'documento.assinatura.assinado',
        'documento.assinatura.exportado',
      ]),
    );
    expect(JSON.stringify(porta.trilhas)).not.toContain(CPF_SINTETICO_SESSAO);
    // Já assinado: nova prévia é recusada.
    expect((await recusada(servico.previa(s, 1, cert))).motivo).toBe('ja-assinado');
  });

  it('lote de 20 atestados numa autorização só: 20 assinadas, um pedido só', async () => {
    for (let i = 0; i < 20; i++) docs.push(documento(100 + i));
    const cert = await vincular();
    const ids = docs.filter((d) => d.id >= 100).map((d) => d.id);
    const { volta, lote } = await assinarNuvem(ids, cert);
    expect(lote.itens).toHaveLength(20);
    expect(volta.lote).toEqual({ assinados: 20, pendentes: 0, recusados: 0 });
    expect(
      porta.trilhas.filter(
        (t) => t.evento === 'documento.assinatura.pedida' && t.chave === 'documento:nuvem:20',
      ),
    ).toHaveLength(1);
    expect(docs.filter((d) => d.id >= 100 && d.nivel === 'icp-brasil')).toHaveLength(20);
  });

  it('recusas do pedido: hash diferente da prévia, sem prévia, documento sem prova; o resto do lote segue', async () => {
    const cert = await vincular();
    await servico.previa(s, 1, cert);
    const p = await servico.pedir(s, {
      documentos: [1, 6, 999],
      hashes: ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)],
      certificado: cert,
    });
    expect(p.inicio).toBeNull();
    expect(p.recusados).toEqual(
      expect.arrayContaining([
        { documento: 1, motivo: 'hash-divergente' },
        { documento: 6, motivo: 'sem-previa' },
        { documento: 999, motivo: 'documento-sem-prova' },
      ]),
    );
    expect(
      trilha.eventos.some((e) => e.evento === 'documento.assinatura.falhou' && e.resultado === 'falha'),
    ).toBe(true);
  });

  it('liberação desligada: 403 com o motivo; sessão "como": recusa', async () => {
    const cert = await vincular();
    const pv = await servico.previa(s, 1, cert);
    ligadas.clear();
    expect(
      await recusada(servico.pedir(s, { documentos: [1], hashes: [pv.hash], certificado: cert })),
    ).toMatchObject({
      status: 403,
      motivo: 'recurso-desligado',
    });
    expect((await servico.fila(s)).motivoDesligada).toContain('assinatura.icp');
    ligadas.add('assinatura.icp');
    expect(
      (
        await recusada(
          servico.pedir(sessao({ como: true }), { documentos: [1], hashes: [pv.hash], certificado: cert }),
        )
      ).motivo,
    ).toBe('sessao-como');
  });

  it('CPF do titular autorizado diferente do usuário: o lote é recusado (regra 2), nada assinado', async () => {
    const cert = await vincular();
    const { volta } = await assinarNuvem([1], cert, CPF_SINTETICO_OUTRO);
    expect(volta).toMatchObject({ finalidade: 'documento', ok: false, motivo: 'cpf-divergente' });
    expect(docs[0]!.eventos).toEqual(['emitido']);
  });

  it('A1/A3 pelo agente local: o desafio com os hashes dos atributos; assinadas e validadas', async () => {
    const t = sim.titular(CPF_SINTETICO_SESSAO);
    const c = await icp.vincularArquivo(s, {
      midia: 'a3',
      provedor: null,
      certificado: Buffer.from(t.certificado).toString('base64'),
    });
    const lote = await servico.prepararLote(s, { documentos: [1, 6], certificado: c.id });
    const p = await servico.pedir(s, {
      documentos: [1, 6],
      hashes: lote.itens.map((x) => x.hash),
      certificado: c.id,
    });
    if (p.inicio?.tipo !== 'agente-local') throw new Error('agente');
    const r = await icp.respostaAgente(s, {
      desafio: p.inicio.desafio,
      certificado: Buffer.from(t.certificado).toString('base64'),
      assinaturas: p.inicio.hashes.map((h) => ({
        hash: h,
        assinatura: Buffer.from(assinarHashRsa(t.chave, Buffer.from(h, 'hex'))).toString('base64'),
      })),
    });
    expect(r).toMatchObject({ finalidade: 'documento', ok: true, lote: { assinados: 2 } });
  });
});

describe('pendente, avisos e reprocessamento (regra 5)', () => {
  it('ACT fora: pendente com aviso ao autor e à direção técnica; volta e o reprocessamento à mão conclui', async () => {
    const cert = await vincular();
    sim.foraDoAr.act = true;
    const { volta } = await assinarNuvem([1], cert);
    expect(volta).toMatchObject({ ok: true, lote: { assinados: 0, pendentes: 1, recusados: 0 } });
    expect(docs[0]!.eventos).toEqual(['emitido']);
    const f = await servico.fila(s);
    const item = f.itens.find((x) => x.documento === 1)!;
    expect(item).toMatchObject({ situacao: 'pendente', falha: 'act-indisponivel', tentativas: 1 });
    expect(item.proximaTentativaEm).not.toBeNull();
    expect(f.avisos).toHaveLength(1);
    const dt = sessao({ login: 'DIRETOR.SINTETICO', pode: (c) => c === 'documento.assinatura.reprocessar' });
    const painel = (await servico.fila(dt)).estabelecimento!;
    expect(painel).toMatchObject({ pendentes: 1, falhas: 0 });
    expect(painel.avisos[0]).toMatchObject({
      destinatario: 'diretor-tecnico',
      autor: LOGIN,
      falha: 'act-indisponivel',
    });
    // Ainda fora: segue pendente, tentativa 2, sem aviso novo.
    expect(await servico.reprocessar(s, item.assinatura!, true)).toMatchObject({
      estado: 'pendente',
      tentativas: 2,
    });
    expect((await servico.fila(s)).avisos).toHaveLength(1);
    sim.foraDoAr.act = false;
    expect(await servico.reprocessar(s, item.assinatura!, true)).toMatchObject({
      estado: 'assinada',
      nivel: 'icp-brasil',
    });
    expect(docs[0]!.eventos).toEqual(['emitido', 'assinado']);
    expect(porta.trilhas.map((t) => t.evento)).toContain('documento.assinatura.reprocessada');
    expect((await recusada(servico.reprocessar(s, item.assinatura!, true))).motivo).toBe('nao-reprocessavel');
    // Avisos: o autor marca os seus; a direção técnica, os dela; o de outro não muda.
    expect(await servico.marcarAvisos(sessao({ login: 'OUTRO' }), [f.avisos[0]!.id])).toEqual({ lidos: 0 });
    expect(await servico.marcarAvisos(s, [f.avisos[0]!.id])).toEqual({ lidos: 1 });
    expect(await servico.marcarAvisos(dt, [painel.avisos[0]!.id])).toEqual({ lidos: 1 });
    expect(porta.trilhas.map((t) => t.evento)).toContain('documento.assinatura.aviso-lido');
  });

  it('o agendador reprocessa as vencidas sozinho; esgotadas as tentativas vira falha com aviso de novo', async () => {
    const cert = await vincular();
    sim.foraDoAr.lcr = true;
    await assinarNuvem([1], cert);
    const a = (await servico.fila(s)).itens.find((x) => x.documento === 1)!.assinatura!;
    // Vencida: o agendador pega (sessão sem pessoa) e, com a LCR de volta, conclui.
    const agendador = sessaoDoAgendador('rede-sintetica', 'pc');
    expect(agendador.login).toBe(USUARIO_REPROCESSAMENTO);
    const futuro = new ServicoAssinaturaDocumentos(icp, porta, fonte, armazem, null, {
      urlVerificador: 'https://portal.exemplo.invalid',
      agora: () => new Date(Date.now() + 10 * 3_600_000),
    });
    sim.foraDoAr.lcr = false;
    expect(await futuro.cicloReprocessamento(agendador)).toMatchObject({ vistas: 1, assinadas: 1 });
    expect(docs[0]!.eventos).toEqual(['emitido', 'assinado']);
    // Outro documento: a LCR fica fora; 12 tentativas → falha, com o aviso de novo ao autor e à direção técnica.
    sim.foraDoAr.lcr = true;
    servico = new ServicoAssinaturaDocumentos(
      icp,
      porta,
      fonte,
      armazem,
      { consultar: async () => ({ ligada: true, motivo: null }) },
      { urlVerificador: 'https://p.invalid' },
    );
    await assinarNuvem([6], cert);
    const b = (await servico.fila(s)).itens.find((x) => x.documento === 6)!.assinatura!;
    let r = await servico.reprocessar(s, b, true);
    for (let i = 0; i < 12 && r.estado === 'pendente'; i++) r = await servico.reprocessar(s, b, true);
    expect(r).toMatchObject({ estado: 'falha', tentativas: 12 });
    expect((await servico.fila(s)).avisos.filter((v) => v.assinatura === b).map((v) => v.estado)).toEqual([
      'falha',
      'pendente',
    ]);
    // À mão, a falha reabre e, com a LCR de volta, conclui.
    sim.foraDoAr.lcr = false;
    expect(await servico.reprocessar(s, b, true)).toMatchObject({ estado: 'assinada' });
    expect(a).toBeGreaterThan(0);
  });

  it('dois pedidos sobre a mesma prévia (duas abas): uma assinatura só e um evento "assinado" só', async () => {
    const cert = await vincular();
    const lote = await servico.prepararLote(s, { documentos: [1], certificado: cert });
    const pedido = { documentos: [1], hashes: lote.itens.map((x) => x.hash), certificado: cert };
    const p1 = await servico.pedir(s, pedido);
    const p2 = await servico.pedir(s, pedido);
    if (p1.inicio?.tipo !== 'nuvem' || p2.inicio?.tipo !== 'nuvem') throw new Error('nuvem');
    const a1 = autorizar(p1.inicio.endereco, CPF_SINTETICO_SESSAO);
    const a2 = autorizar(p2.inicio.endereco, CPF_SINTETICO_SESSAO);
    expect(await icp.retornoPsc(s, a1)).toMatchObject({ ok: true, lote: { assinados: 1 } });
    expect(await icp.retornoPsc(s, a2)).toMatchObject({
      ok: false,
      motivo: 'ja-assinado',
      lote: { assinados: 0, pendentes: 0, recusados: 1 },
    });
    expect(docs[0]!.eventos).toEqual(['emitido', 'assinado']);
    expect((await servico.fila(s)).assinados.filter((a) => a.documento === 1)).toHaveLength(1);
  });

  it('a falha antiga reaberta à mão depois de o documento ser assinado de novo: recusa, sem segundo evento', async () => {
    const cert = await vincular();
    sim.foraDoAr.act = true;
    await assinarNuvem([1], cert);
    const antiga = (await servico.fila(s)).itens.find((x) => x.documento === 1)!.assinatura!;
    // Esgotada (falha): o autor assina de novo, e com a ACT de volta conclui.
    const assins = (porta as unknown as { assins: { id: number; estado: string }[] }).assins;
    assins.find((a) => a.id === antiga)!.estado = 'falha';
    sim.foraDoAr.act = false;
    expect((await assinarNuvem([1], cert)).volta).toMatchObject({ ok: true, lote: { assinados: 1 } });
    const dt = sessao({ login: 'DIRETOR.SINTETICO', pode: (c) => c === 'documento.assinatura.reprocessar' });
    expect(await recusada(servico.reprocessar(dt, antiga, true))).toEqual({
      status: 409,
      motivo: 'ja-assinado',
    });
    expect(assins.find((a) => a.id === antiga)!.estado).toBe('falha');
    expect(docs[0]!.eventos).toEqual(['emitido', 'assinado']);
  });

  it('reprocessar a de outro autor sem a permissão da direção técnica: 403', async () => {
    const cert = await vincular();
    sim.foraDoAr.act = true;
    await assinarNuvem([1], cert);
    const a = (await servico.fila(s)).itens.find((x) => x.documento === 1)!.assinatura!;
    expect((await recusada(servico.reprocessar(sessao({ login: 'OUTRO' }), a, true))).status).toBe(403);
  });

  it('a rodada do agendador usa a rede da configuração (REDE_PADRAO), sem rede literal; sem rede, não roda', async () => {
    const controle = new AssinaturaDocumentosController(icp, porta, {
      urlVerificador: 'https://portal.exemplo.invalid',
    });
    const vistas: { rede: string; hospital: string; porta: unknown }[] = [];
    controle.servico.cicloReprocessamento = async (x: SessaoCadastro) => {
      vistas.push({ rede: x.rede, hospital: x.hospital, porta: x.porta });
      return { vistas: 1, assinadas: 0, pendentes: 0, falhas: 0 };
    };
    expect(await controle.rodada({ ESTABELECIMENTOS: 'pc', REDE_PADRAO: 'rede-a' })).toBe(1);
    expect(vistas).toEqual([{ rede: 'rede-a', hospital: 'pc', porta: { rede: 'rede-a', hospital: 'pc' } }]);
    // As variáveis que não existem no repositório não valem; sem REDE_PADRAO (ou inválida), nada roda.
    expect(await controle.rodada({ ESTABELECIMENTOS: 'pc', REDE: 'x', PRODUTO_REDE: 'y' })).toBe(0);
    expect(await controle.rodada({ ESTABELECIMENTOS: 'pc', REDE_PADRAO: 'Rede Inválida' })).toBe(0);
    expect(vistas).toHaveLength(1);
    expect(redeDoAgendador({ REDE_PADRAO: ' rede-b ' })).toBe('rede-b');
    expect(redeDoAgendador({})).toBeNull();
  });

  it('o agendador: ligado fora de dev/ci; em dev/ci só com ASSINATURA_REPROCESSAR=ligado', () => {
    expect(reprocessamentoLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(reprocessamentoLigado({ AMBIENTE: 'producao', ASSINATURA_REPROCESSAR: 'desligado' })).toBe(false);
    expect(reprocessamentoLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(reprocessamentoLigado({ AMBIENTE: 'ci', ASSINATURA_REPROCESSAR: 'ligado' })).toBe(true);
  });
});

describe('numeração SNCR (regra 10; chave receita.sncr desligada)', () => {
  it('desligada: recusa com o motivo; ligada no simulador: 16 dígitos no campo da receita; atestado não se aplica', async () => {
    expect(await recusada(servico.solicitarSncr(s, 6))).toMatchObject({
      status: 409,
      motivo: 'sncr-desligada',
    });
    ligadas.add('receita.sncr');
    const r = await servico.solicitarSncr(s, 6);
    expect(r).toMatchObject({ documento: 6, situacao: 'numerada', tentativas: 1 });
    expect(r.numero).toMatch(/^\d{16}$/);
    expect(porta.numerosSncr.get('pc:6')).toBe(r.numero);
    expect((await recusada(servico.solicitarSncr(s, 1))).motivo).toBe('sncr-nao-aplicavel');
    sncr.foraDoAr = true;
    expect(await servico.solicitarSncr(s, 6)).toMatchObject({ situacao: 'pendente', numero: null });
    expect(porta.trilhas.map((t) => t.evento)).toContain('documento.sncr.solicitada');
  });
});

describe('configuração do ambiente', () => {
  it('a política ICP-Brasil "oid:hash" e a base do verificador', () => {
    expect(politicaDoAmbiente(`2.16.76.1.7.1.11.1.1:${'a'.repeat(64)}`)).toEqual({
      oid: '2.16.76.1.7.1.11.1.1',
      hashSha256: 'a'.repeat(64),
    });
    expect(politicaDoAmbiente('x')).toBeNull();
    const c = configDocumentosIcpDoAmbiente(
      {
        PORTAL_ENDERECO: 'https://portal.invalid',
        ASSINATURA_POLITICA_AD_RT: `2.16.76.1.7.1.12.1.1:${'b'.repeat(64)}`,
      },
      null,
    );
    expect(c.urlVerificador).toBe('https://portal.invalid');
    expect(c.politicas?.['AD-RT']?.oid).toBe('2.16.76.1.7.1.12.1.1');
    expect(configDocumentosIcpDoAmbiente({ WEB_PORTA: '5449' }, null).urlVerificador).toBe(
      'http://127.0.0.1:5449',
    );
  });
});
