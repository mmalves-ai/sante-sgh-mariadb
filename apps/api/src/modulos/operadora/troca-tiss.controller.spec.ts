// Rota POST /api/operadora/troca-tiss/mensagens (08-SGO linha 107, C2-061) chamada no controlador, com portas falsas e
// mensagens TISS 4.03 SINTÉTICAS montadas pelo gerador do hospital (válidas no XSD oficial, com o hash do epílogo):
//   - o pedido de autorização (SOLICITACAO_PROCEDIMENTOS) vira o pedido da operadora pelas regras do portal
//     (conferirRegistro), é gravado pela porta da autorização com o protocolo e a troca fica processada;
//   - sem a origem "troca eletrônica" cadastrada, a mensagem fica rejeitada com o motivo e nenhum pedido é gravado;
//   - a carteirinha fora do padrão: rejeitada com o campo, nenhum pedido gravado;
//   - sem a permissão de registrar pedido, 403 e nada gravado;
//   - hash adulterado e sequencial repetido: recusa (409) sem registro;
//   - a comunicação de internação válida fica processada; a de evento futuro fica rejeitada com o motivo.
// A gravação no MariaDB está provada no troca-tiss-propria.int.spec (porta) e no int.spec da autorização (pedido).
import {
  type DadosMensagemSolicitacao,
  mensagemComunicacaoBeneficiario,
  mensagemSolicitacaoAutorizacao,
} from '@sgh/dominio-faturamento';
import { numeroCarteirinha } from '@sgh/dominio-operadora';
import { describe, expect, it, vi } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import type { PortaAutorizacaoOperadoraPropria } from './autorizacao-porta-propria.js';
import type { ApoioRecebimentoTroca, PortaTrocaTissPropria } from './troca-tiss-propria.js';
import { TrocaTissOperadoraController } from './troca-tiss.controller.js';

const REGISTRO = '999999';
const PRESTADOR = 'HSINT01';
const CARTEIRA = numeroCarteirinha(REGISTRO, 1);

const dados = (x: Partial<DadosMensagemSolicitacao> = {}): DadosMensagemSolicitacao => ({
  tipo: 'sp_sadt',
  sequencialTransacao: '17',
  data: '2026-11-24',
  hora: '10:15:00',
  registroAns: REGISTRO,
  codigoPrestador: PRESTADOR,
  nomeContratado: 'Hospital sintético',
  cnes: '1234567',
  numeroGuia: 'SA-17',
  numeroGuiaPrincipal: null,
  carteira: CARTEIRA,
  recemNascido: false,
  solicitante: {
    nome: 'Profissional sintético',
    conselho: '06',
    numeroConselho: '12345',
    uf: '35',
    cbo: '225125',
    telefone: '1130000000',
  },
  urgencia: false,
  indicacaoClinica: 'Indicação sintética',
  regime: null,
  tipoInternacao: null,
  diarias: null,
  dataAdmissao: null,
  cids: [],
  acidente: null,
  observacao: null,
  itens: [
    {
      codigoTabela: '22',
      codigoProcedimento: '40301010',
      descricao: 'Procedimento sintético',
      quantidade: 2,
      valorUnitario: null,
      opme: false,
      registroAnvisa: null,
      fabricante: null,
      opcaoFabricante: null,
    },
  ],
  ...x,
});

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const comunicacao = (dataEvento: string) =>
  mensagemComunicacaoBeneficiario(
    {
      sequencialTransacao: '18',
      data: '2026-11-24',
      hora: '11:00:00',
      codigoPrestadorNaOperadora: PRESTADOR,
      registroANS: REGISTRO,
    },
    {
      beneficiario: { numeroCarteira: 'SINT0001', atendimentoRN: false },
      dataEvento,
      tipoEvento: 'I',
      tipoInternacao: '1',
      motivoEncerramento: null,
    },
  );

function montar(o: { apoio?: Partial<ApoioRecebimentoTroca>; pode?: boolean } = {}) {
  const apoio: ApoioRecebimentoTroca = {
    operadora: { id: 3, registroAns: REGISTRO },
    prestador: 7,
    sequencialRepetido: false,
    hoje: '2026-11-25',
    tipoGuia: { sp_sadt: 11, internacao: 12 },
    origemTroca: 13,
    ...o.apoio,
  };
  const porta = {
    apoioRecebimento: vi.fn(async () => apoio),
    registrarRecebida: vi.fn(async () => ({ id: 41 })),
    receberCancelamento: vi.fn(),
    receberComunicacao: vi.fn(async () => ({
      troca: 42,
      situacao: 'aceita',
      beneficiarioIdentificado: true,
    })),
    trocas: vi.fn(async () => []),
  } as unknown as PortaTrocaTissPropria;
  const registrar = vi.fn(async () => ({ id: 9 }));
  const autorizacoes = {
    gravar: vi.fn(async (_c: unknown, _t: unknown, fn: (g: unknown) => Promise<unknown>) =>
      fn({ proximoProtocolo: async () => 5, registrar }),
    ),
  } as unknown as PortaAutorizacaoOperadoraPropria;
  const c = new TrocaTissOperadoraController(porta, autorizacoes);
  vi.spyOn(c.situacoes, 'exigir').mockResolvedValue(undefined);
  const conferir = vi.spyOn(c.autorizacao, 'conferirRegistro').mockResolvedValue({
    registroAns: REGISTRO,
    registro: { solicitadaEm: '2026-11-25T09:00:00' },
  } as unknown as Awaited<ReturnType<typeof c.autorizacao.conferirRegistro>>);
  const req = {
    headers: {},
    sgh: {
      real: true,
      sessao: { estabelecimentoAtivo: 'aa', rede: '', usuario: { id: '1', login: 'SINT.OPERADORA' } },
      ability: { can: () => o.pode ?? true },
    },
  } as unknown as RequisicaoAutorizada;
  return { c, req, porta, autorizacoes, registrar, conferir };
}

const erro = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) =>
      e instanceof ErroProblema ? { status: e.getStatus(), tipo: e.tipo, extras: e.extras } : String(e),
  );

describe('POST /api/operadora/troca-tiss/mensagens (controlador)', () => {
  it('pedido de autorização: vira o pedido pelas regras do portal, com protocolo, e a troca fica processada', async () => {
    const { c, req, porta, autorizacoes, registrar, conferir } = montar();
    const m = mensagemSolicitacaoAutorizacao(dados());
    const r = await c.receber({ arquivo: b64(m.bytes), canal: 'webservice' }, req);
    expect(r).toMatchObject({
      troca: 41,
      tipo: 'solicitacao_procedimento',
      situacao: 'processada',
      motivos: [],
    });
    expect(r.protocolo).toBe('99999920261125000005');
    expect(conferir).toHaveBeenCalledTimes(1);
    expect(conferir.mock.calls[0]![1]).toMatchObject({
      carteirinha: CARTEIRA,
      prestador: 7,
      tipoGuia: 11,
      carater: 'E',
    });
    expect(autorizacoes.gravar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ protocolo: '99999920261125000005', usuario: 'SINT.OPERADORA' }),
    );
    const [, troca, resultado] = vi.mocked(porta.registrarRecebida).mock.calls[0]!;
    expect(troca).toMatchObject({ canal: 'webservice', operadora: 3, prestador: 7 });
    expect(troca.cabecalho).toMatchObject({ transacao: 'SOLICITACAO_PROCEDIMENTOS', sequencial: '17' });
    expect(resultado).toEqual({ situacao: 'processada', protocolo: '99999920261125000005', erro: null });
  }, 60_000);

  it('sem a origem "troca eletrônica" cadastrada: rejeitada com o motivo, nenhum pedido gravado', async () => {
    const { c, req, porta, autorizacoes } = montar({ apoio: { origemTroca: null } });
    const m = mensagemSolicitacaoAutorizacao(dados());
    const r = await c.receber({ arquivo: b64(m.bytes) }, req);
    expect(r.situacao).toBe('rejeitada');
    expect(r.motivos.join(' ')).toContain('troca eletrônica');
    expect(autorizacoes.gravar).not.toHaveBeenCalled();
    expect(vi.mocked(porta.registrarRecebida).mock.calls[0]![2]).toMatchObject({
      situacao: 'rejeitada',
      protocolo: null,
    });
  }, 60_000);

  it('carteirinha fora do padrão: a recusa das regras do pedido não perde a mensagem (rejeitada com o campo)', async () => {
    const { c, req, porta, autorizacoes } = montar();
    const m = mensagemSolicitacaoAutorizacao(dados({ carteira: 'SINT0001' }));
    const r = await c.receber({ arquivo: b64(m.bytes) }, req);
    expect(r.situacao).toBe('rejeitada');
    expect(r.motivos).toContain('Campo: carteirinha.');
    expect(autorizacoes.gravar).not.toHaveBeenCalled();
    expect(vi.mocked(porta.registrarRecebida).mock.calls[0]![2]).toMatchObject({ situacao: 'rejeitada' });
  }, 60_000);

  it('sem a permissão de registrar pedido: 403 e nada gravado', async () => {
    const { c, req, porta, autorizacoes } = montar({ pode: false });
    const m = mensagemSolicitacaoAutorizacao(dados());
    expect(await erro(c.receber({ arquivo: b64(m.bytes) }, req))).toMatchObject({
      status: 403,
      tipo: 'sem-permissao',
    });
    expect(autorizacoes.gravar).not.toHaveBeenCalled();
    expect(porta.registrarRecebida).not.toHaveBeenCalled();
  }, 60_000);

  it('hash adulterado e sequencial repetido: recusa sem registro', async () => {
    const m = mensagemSolicitacaoAutorizacao(dados());
    const adulterado = Buffer.from(
      Buffer.from(m.bytes)
        .toString('latin1')
        .replace(/<ans:hash>[^<]*<\/ans:hash>/, '<ans:hash>00000000000000000000000000000000</ans:hash>'),
      'latin1',
    );
    const a = montar();
    expect(await erro(a.c.receber({ arquivo: adulterado.toString('base64') }, a.req))).toMatchObject({
      status: 409,
      extras: { codigo: 'hash-nao-confere' },
    });
    expect(a.porta.apoioRecebimento).not.toHaveBeenCalled();
    const b = montar({ apoio: { sequencialRepetido: true } });
    expect(await erro(b.c.receber({ arquivo: b64(m.bytes) }, b.req))).toMatchObject({
      status: 409,
      extras: { codigo: 'transacao-repetida' },
    });
    expect(b.porta.registrarRecebida).not.toHaveBeenCalled();
    expect(b.autorizacoes.gravar).not.toHaveBeenCalled();
  }, 60_000);

  it('comunicação de internação: válida fica processada; com evento futuro fica rejeitada com o motivo', async () => {
    const a = montar();
    const ok = await a.c.receber({ arquivo: b64(comunicacao('2026-11-24').bytes) }, a.req);
    expect(ok).toMatchObject({
      troca: 42,
      tipo: 'comunicacao_internacao',
      situacao: 'processada',
      comunicacao: { situacao: 'aceita', beneficiarioIdentificado: true },
    });
    expect(a.porta.receberComunicacao).toHaveBeenCalledTimes(1);
    const b = montar();
    const futuro = await b.c.receber({ arquivo: b64(comunicacao('2026-12-30').bytes) }, b.req);
    expect(futuro.situacao).toBe('rejeitada');
    expect(futuro.motivos).toContain('A data do evento não pode ser futura.');
    expect(b.porta.receberComunicacao).not.toHaveBeenCalled();
  }, 60_000);
});
