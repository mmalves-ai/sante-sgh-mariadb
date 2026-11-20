// Integração do verificador público (ficha do M49, regra 9: `verificador-taxa.int-spec`), na cópia e no Valkey do
// Compose, sempre em transação DESFEITA, sobre a porta do legado numa transação aberta (script 0498):
//   - um documento do novo assinado (sintético: o documento, o certificado, a prévia com o selo, a assinatura, o PDF e a
//     validação) é achado pelo código do QR e mostrado como "válida", com o tipo e o profissional e sem o paciente;
//   - o LIMITE DE TAXA no armazém compartilhado (Valkey; o mesmo contador para duas instâncias do serviço): acima do
//     limite por minuto, 429, e só a primeira barrada vira linha; outra origem segue consultando;
//   - cada consulta grava SGH_DOC_VERIFICACAO com a origem mascarada e a SGH_TRILHA; só tabelas SGH_ escritas;
//   - ROLLBACK provado pela contagem.
import {
  consultasDaPrevia,
  contagemVerificacoes,
  escritasDaTransacao,
  gravarAssinaturaIcp,
  gravarAssinaturaPdf,
  gravarCertificado,
  gravarDocumentoSgh,
  gravarPreviaAssinatura,
  gravarValidacaoIcp,
  registrarPdfAssinado,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemValkey } from '../../sessao/valkey.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';
import { ServicoVerificador } from './aplicacao/verificador.js';
import { portaAssinaturaNaTransacao } from './porta-legado.js';

const LOGIN = 'SGH.TESTE.M493';
const URL_VALKEY = process.env['VALKEY_URL']?.trim() || 'redis://127.0.0.1:63718';
const agora = new Date('2026-10-24T12:00:00.000Z');
const LIMITE = 3;

const configuracao = (rede: string) =>
  ({
    valoresParametro: async () => [
      {
        id: '1',
        chave: 'documento.verificadorConsultasPorMinuto',
        nivel: 'rede',
        alvo: rede,
        valor: String(LIMITE),
        vigenteDesde: '2026-01-01',
        vigenteAte: null,
        justificativa: 'teste de integração',
        autor: LOGIN,
      },
    ],
  }) as never;

describe.skipIf(!PODE_ESCREVER)('verificador público na cópia e no Valkey (transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('achado e "válida" sem o paciente; limite de taxa compartilhado (429, uma barrada); só SGH_; ROLLBACK', async () => {
    const ctx = { ...a.c, traceId: 'int-m493' };
    const antes = await a.nucleo.lerSomente(ctx, (l) => contagemVerificacoes(l, a.cod));
    // Uma rede só deste teste: o contador do Valkey não se mistura com o do dev nem com outra rodada.
    const rede = `int-m493-${process.pid}-${Date.now()}`;
    const codigo = `VER${a.cod}M493TAXA00000001`;
    const r = await a.nucleo.desfazendoNaCopia(ctx, async (e) => {
      const doc = await gravarDocumentoSgh(
        e,
        { hospital: a.cod, usuarioLegado: LOGIN },
        {
          tipo: 'atestado',
          origemTabela: 'PRATESTREQIMP',
          origemId: 900_000_494,
          idAssinaturaDoc: null,
          paciente: 900_000_494,
          atendimento: null,
          cbo: null,
          hashConteudo: 'f'.repeat(64),
        },
      );
      const cert = await gravarCertificado(e, {
        hospital: a.cod,
        usuario: LOGIN,
        midia: 'nuvem',
        provedor: 'simulador',
        idTipoCertificado: null,
        serie: '5a1e0494',
        emissorHash: 'a'.repeat(64),
        tipoIcp: 'A3',
        validoDe: agora,
        validoAte: new Date('2027-10-24T12:00:00.000Z'),
        cpfMascarado: '***.000.001-**',
        certificadoDer: 'MIIBsintetico',
      });
      const pv = await gravarPreviaAssinatura(e, {
        hospital: a.cod,
        documento: doc,
        usuario: LOGIN,
        certificado: cert.id,
        politicaIcp: 'AD-RT',
        hashPdf: 'e'.repeat(64),
        chaveS3: `rede/${a.cod}/documentos/atestado/x/via-1.pdf`,
        versaoS3: 'v1',
        codigo,
        assinarEm: agora.toISOString(),
        profissional: 'Profissional Sintético',
        registro: 'CRM-RJ 000000',
      });
      const as = await gravarAssinaturaIcp(e, {
        hospital: a.cod,
        origem: 'documento',
        documento: doc,
        hash: 'c'.repeat(64),
        formato: 'pades',
        politicaIcp: 'AD-RT',
        midia: 'nuvem',
        provedor: 'simulador',
        certificado: cert.id,
        usuario: LOGIN,
        estado: 'assinada',
        tentativas: 0,
        falha: null,
        proximaEm: null,
        assinatura: 'QUJD',
        carimboToken: 'REVG',
        carimboEm: agora,
        carimboSerie: '0a0b',
      });
      await gravarAssinaturaPdf(e, { assinatura: as.id, previa: pv.id });
      await registrarPdfAssinado(
        e,
        { assinatura: as.id, chaveS3: `assinado/${as.id}`, versaoS3: 'v1', hashPdf: 'b'.repeat(64) },
        agora,
      );
      await gravarValidacaoIcp(e, {
        assinatura: as.id,
        momento: 'assinar',
        resultado: 'valida',
        cadeia: true,
        vigencia: true,
        revogacao: true,
        cpf: true,
        assinaturaConfere: true,
        carimbo: true,
        motivos: [],
        usuario: LOGIN,
        em: agora,
      });
      const porta = portaAssinaturaNaTransacao(e);
      // Duas "instâncias" do serviço com o MESMO Valkey: o limite vale para as duas juntas.
      const cfg = { rede, estabelecimentos: [a.cod], endereco: 'https://portal.exemplo' };
      const um = new ServicoVerificador(porta, new ArmazemValkey(URL_VALKEY), configuracao(rede), cfg);
      const outro = new ServicoVerificador(porta, new ArmazemValkey(URL_VALKEY), configuracao(rede), cfg);
      const ip = '203.0.113.77';
      const respostas = [];
      for (const s of [um, outro, um]) respostas.push(await s.verificar(codigo, ip));
      const barradas: number[] = [];
      for (const s of [outro, um])
        await s.verificar(codigo, ip).catch((x: { status: number }) => barradas.push(x.status));
      const deOutraOrigem = await outro.verificar(codigo, '198.51.100.20');
      const linhas = await consultasDaPrevia(e, a.cod, pv.id, ['203.0.113.0', '198.51.100.0']);
      return { respostas, barradas, deOutraOrigem, linhas, escritas: await escritasDaTransacao(e) };
    });
    expect(r.respostas.map((x) => x.situacao)).toEqual(['valida', 'valida', 'valida']);
    expect(r.respostas[0]).toMatchObject({
      tipoDocumento: 'Atestado',
      profissional: 'Profissional Sintético',
      registro: 'CRM-RJ 000000',
      hashPdf: 'b'.repeat(64),
    });
    expect(JSON.stringify(r.respostas)).not.toContain('900000494');
    expect(r.barradas).toEqual([429, 429]);
    expect(r.deOutraOrigem.situacao).toBe('valida');
    // 3 + 1 (outra origem) achadas, todas com a origem mascarada; e UMA barrada (as 5 linhas da transação).
    expect(r.linhas).toEqual({ consultas: 4, daLista: 4 });
    for (const w of r.escritas) expect(w.tabela).toMatch(/^SGH_/);
    expect(r.escritas.find((w) => w.tabela === 'SGH_DOC_VERIFICACAO')?.insercoes).toBe(5);
    expect(r.escritas.find((w) => w.tabela === 'SGH_TRILHA')?.insercoes).toBe(5);
    expect(await a.nucleo.lerSomente(ctx, (l) => contagemVerificacoes(l, a.cod))).toBe(antes);
  });
});
