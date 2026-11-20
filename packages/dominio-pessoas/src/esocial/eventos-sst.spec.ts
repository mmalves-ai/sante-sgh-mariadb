// S-2210 (CAT, W0-06): o original, a retificação (indRetif 2 com o recibo) e a exclusão pelo S-3000 validam no XSD
// oficial do leiaute S-1.3 (evtCAT.xsd do pacote de 2026-10-26, conferido pelo SHA256SUMS); pendências impedem o evento.
import { beforeAll, describe, expect, it } from 'vitest';
import { type ResultadoEventoEsocial, xmlDoEvento, xmlParaConferencia } from './comum.js';
import { type CatParaEvento, montarS2210, pendenciasCat } from './eventos-sst.js';
import { montarS3000 } from './eventos-trabalhador.js';
import { CPF, ctx, empregador, trabalhador } from './fixtures-esocial.spec-util.js';
import { type ArquivoEsquemaEsocial, esquemasDoLeiaute, validarEventoNoXsd } from './xsd.js';

let esquemas: ArquivoEsquemaEsocial[];
beforeAll(async () => {
  esquemas = await esquemasDoLeiaute('v_S_01_03_00');
});

const RECIBO = '1.2.0000000000000000001';

const cat: CatParaEvento = {
  id: 7,
  ocorridoEm: '2026-11-10T14:35',
  tipo: 'tipico',
  horasTrabalhadasAntes: '0430',
  tipoCat: 1,
  obito: false,
  dataObito: null,
  comunicouPolicia: false,
  situacaoGeradora: 200004300,
  observacao: 'Perfuração com agulha ao descartar material.',
  ultimoDiaTrabalhado: null,
  houveAfastamento: false,
  local: {
    tipo: 1,
    descricao: 'Posto de enfermagem do 3º andar',
    logradouro: 'Rua Sintética',
    numero: '100',
    cep: '01001000',
    municipio: '3550308',
    uf: 'SP',
  },
  parteAtingida: 753030000,
  lateralidade: 2,
  agenteCausador: 302010600,
  atestado: {
    data: '2026-11-10',
    hora: '1510',
    internacao: false,
    duracaoDias: 1,
    afastamento: false,
    naturezaLesao: 702010000,
    complementoLesao: null,
    diagnostico: 'Ferimento puntiforme',
    cid: 'W46',
    emitenteNome: 'Médica Sintética',
    emitenteConselho: 1,
    emitenteNumero: '123456',
    emitenteUf: 'SP',
  },
  reciboCatOrigem: null,
};

async function conferir(r: ResultadoEventoEsocial, raiz: string) {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  if (!r.ok) throw new Error('montagem');
  const v = await validarEventoNoXsd(xmlParaConferencia(r.raiz), raiz, esquemas);
  expect(v.erros).toEqual([]);
  expect(v.valido).toBe(true);
  return xmlDoEvento(r.raiz);
}

describe('S-2210 no XSD oficial', () => {
  it('original: indRetif 1, CAT do empregador, local com o CNPJ do estabelecimento', async () => {
    const xml = await conferir(montarS2210(ctx, empregador, trabalhador, cat, null), 'evtCAT');
    expect(xml).toContain('<indRetif>1</indRetif>');
    expect(xml).not.toContain('<nrRecibo>');
    expect(xml).toContain('<tpAcid>1</tpAcid><hrAcid>1435</hrAcid><hrsTrabAntesAcid>0430</hrsTrabAntesAcid>');
    expect(xml).toContain('<iniciatCAT>1</iniciatCAT>');
    expect(xml).toContain(
      `<ideLocalAcid><tpInsc>1</tpInsc><nrInsc>${empregador.cnpj}</nrInsc></ideLocalAcid>`,
    );
    expect(xml).toContain('<codCID>W46</codCID>');
  });

  it('retificação: indRetif 2 com o recibo do S-2210 aceito (substitui o evento inteiro)', async () => {
    const xml = await conferir(
      montarS2210(
        ctx,
        empregador,
        trabalhador,
        { ...cat, atestado: { ...cat.atestado!, cid: 'W460' } },
        RECIBO,
      ),
      'evtCAT',
    );
    expect(xml).toContain(`<indRetif>2</indRetif><nrRecibo>${RECIBO}</nrRecibo>`);
    expect(xml).toContain('<codCID>W460</codCID>');
  });

  it('doença: sem hora; óbito com a data e a CAT de origem', async () => {
    const xml = await conferir(
      montarS2210(
        ctx,
        empregador,
        trabalhador,
        {
          ...cat,
          tipo: 'doenca',
          horasTrabalhadasAntes: null,
          tipoCat: 3,
          obito: true,
          dataObito: '2026-11-12',
          reciboCatOrigem: RECIBO,
          local: { ...cat.local, tipo: 4, descricao: null },
        },
        null,
      ),
      'evtCAT',
    );
    expect(xml).toContain('<tpAcid>2</tpAcid><tpCat>3</tpCat>');
    expect(xml).not.toContain('<hrAcid>');
    expect(xml).toContain(`<catOrigem><nrRecCatOrig>${RECIBO}</nrRecCatOrig></catOrigem>`);
    expect(xml).not.toContain('<ideLocalAcid>');
  });

  it('anulação: S-3000 do S-2210 aceito', async () => {
    const xml = await conferir(
      montarS3000(
        ctx,
        empregador,
        { evento: 'S-2210', recibo: RECIBO, cpf: CPF, dataReferencia: '2026-11-10' },
        '2026-11-18',
      ),
      'evtExclusao',
    );
    expect(xml).toContain('<tpEvento>S-2210</tpEvento>');
    expect(xml).toContain(`<nrRecEvt>${RECIBO}</nrRecEvt>`);
  });
});

describe('S-2210: pendências', () => {
  it('sem atestado, códigos fora da tabela, sem hora e sem origem na reabertura', () => {
    const p = pendenciasCat({
      ...cat,
      horasTrabalhadasAntes: null,
      tipoCat: 2,
      situacaoGeradora: 12,
      parteAtingida: null,
      lateralidade: null,
      agenteCausador: null,
      local: { ...cat.local, logradouro: ' ' },
      atestado: null,
    }).map((x) => x.codigo);
    expect(p).toEqual([
      'cat-sem-horas-antes',
      'cat-sem-origem',
      'cat-sem-situacao',
      'cat-sem-parte',
      'cat-sem-lateralidade',
      'cat-sem-agente',
      'cat-sem-local',
      'cat-sem-atestado',
    ]);
  });

  it('atestado incompleto e empregador sem CNPJ: nenhum XML', () => {
    const r = montarS2210(
      ctx,
      { ...empregador, cnpj: null },
      trabalhador,
      {
        ...cat,
        atestado: { ...cat.atestado!, cid: 'W46.0', naturezaLesao: 1, emitenteNumero: null, hora: '2460' },
      },
      null,
    );
    expect(r.ok).toBe(false);
    expect(r.ok ? [] : r.pendencias.map((x) => x.codigo)).toEqual([
      'empregador-sem-cnpj',
      'cat-sem-hora-atendimento',
      'cat-sem-natureza',
      'cat-sem-cid',
      'cat-sem-emitente',
    ]);
  });
});
