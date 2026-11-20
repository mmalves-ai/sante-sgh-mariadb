// @vitest-environment jsdom
// Regras de tela do atendimento (M20): o preenchimento pelo agendamento, o tipo inicial da abertura pela senha, a
// oferta de "Abrir atendimento" no dia, o PDF como arquivo do navegador e o item do menu com a permissão da rota.
import { type ApoioAtendimento, ARVORE_MENU, type MarcacaoAbertura } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import { criarRoteador } from '../../roteador.js';
import { mensagensAtendimento } from './i18n.js';
import {
  type CamposCorrecao,
  blobDoPdf,
  camposDaFicha,
  dependentesDoErro,
  entradaDaCorrecao,
  hojeIso,
  itensComPermissaoDiferente,
  ofereceAbertura,
  preenchimentoDaMarcacao,
  tipoInicialDaAbertura,
} from './regras-tela.js';

const APOIO: ApoioAtendimento = {
  convenios: [
    { codigo: 306, nome: 'CONVENIO SINTETICO', aceita: true, motivo: null },
    { codigo: 99, nome: 'SUSPENSO SINTETICO', aceita: false, motivo: 'suspenso' },
  ],
  unidades: [{ codigo: 1, nome: 'AMBULATORIO' }],
  especialidades: [
    { codigo: 15, nome: 'CLINICA MEDICA' },
    { codigo: 33, nome: 'PEDIATRIA' },
  ],
  profissionais: [
    { id: 7100, crm: 52001, nome: 'OUTRO VINCULO', especialidades: [33], conselhoAtivo: true },
    { id: 7101, crm: 52001, nome: 'ANA MEDICA', especialidades: [15], conselhoAtivo: true },
  ],
  centrosCusto: [{ codigo: 300600, nome: 'AMBULATORIO' }],
  locais: [{ id: 3, descricao: 'CONSULTORIO 01' }],
  procedimentosPadrao: [],
  motivosExclusao: [],
  heranca: [],
};
const MARCACAO: MarcacaoAbertura = {
  id: 880001,
  data: '2026-10-22',
  hora: '08:00',
  hoje: true,
  registro: 0,
  paciente: { id: 1007, nome: 'PACIENTE SINTETICO', prontuario: 9007, nascimento: null },
  convenio: 306,
  crm: 52001,
  especialidade: 15,
  unidade: 1,
  centroCusto: 300600,
  procedimento: 10101012,
  retorno: true,
};

describe('abertura pelo agendamento e pela senha', () => {
  it('o agendamento preenche o convênio aceito, o vínculo da especialidade, a unidade e o procedimento', () => {
    expect(preenchimentoDaMarcacao(MARCACAO, APOIO)).toEqual({
      convenio: '306',
      especialidade: '15',
      profissional: '7101',
      unidade: '1',
      centroCusto: '300600',
      procedimento: '10101012',
      retorno: true,
    });
    // O que o apoio não tem (convênio suspenso, profissional sem vínculo, especialidade desconhecida) fica vazio.
    expect(
      preenchimentoDaMarcacao(
        { ...MARCACAO, convenio: 99, crm: 1, especialidade: 77, unidade: 9, centroCusto: 0, procedimento: 0 },
        APOIO,
      ),
    ).toEqual({
      convenio: '',
      especialidade: '',
      profissional: '',
      unidade: '',
      centroCusto: '',
      procedimento: '',
      retorno: true,
    });
    // Sem o vínculo da especialidade, o primeiro do mesmo conselho.
    expect(preenchimentoDaMarcacao({ ...MARCACAO, especialidade: 9 }, APOIO).profissional).toBe('7100');
  });

  it('da senha, o tipo fica sem padrão (qualquer recepção chama senha); do agendamento ou direta, consulta', () => {
    expect(tipoInicialDaAbertura({ senha: 3001 })).toBe('');
    expect(tipoInicialDaAbertura({ senha: null })).toBe('consulta');
  });

  it('"Abrir atendimento" só na marcação de hoje, ainda não atendida, com o paciente do cadastro', () => {
    const m = { data: '2026-10-22', estado: 'confirmada', idPaciente: 1007 };
    expect(ofereceAbertura(m, '2026-10-22')).toBe(true);
    expect(ofereceAbertura({ ...m, estado: 'chegou' }, '2026-10-22')).toBe(true);
    expect(ofereceAbertura({ ...m, estado: 'atendida' }, '2026-10-22')).toBe(false);
    expect(ofereceAbertura({ ...m, estado: 'faltou' }, '2026-10-22')).toBe(false);
    expect(ofereceAbertura(m, '2026-10-23')).toBe(false);
    expect(ofereceAbertura({ ...m, idPaciente: null }, '2026-10-22')).toBe(false);
  });
});

describe('impressos', () => {
  it('o PDF em base64 vira um arquivo application/pdf com os mesmos bytes', async () => {
    const b = blobDoPdf(btoa('%PDF-1.7 sintetico'));
    expect(b.type).toBe('application/pdf');
    expect(b.size).toBe(18);
    expect(new TextDecoder().decode(await b.arrayBuffer())).toBe('%PDF-1.7 sintetico');
  });
});

describe('menu × rota', () => {
  it('a conferência acha o item cuja permissão difere da rota de destino', () => {
    const rotas: Record<string, string> = { '/pa/quadro': 'pa.quadro.ler' };
    expect(
      itensComPermissaoDiferente(
        [
          { id: 'a', rota: '/pa/quadro', permissao: 'pa.desfecho.registrar' },
          { id: 'b', rota: '/pa/quadro?x=1', permissao: 'pa.quadro.ler' },
          { id: 'c', rota: null, permissao: null },
          { id: 'd', rota: '/outra', permissao: 'x.y.z' },
        ],
        (c) => rotas[c],
      ),
    ).toEqual(['a']);
  });

  it('os itens do menu do atendimento e do PA exigem a permissão da rota de destino (ninguém cai em "sem permissão")', () => {
    const r = criarRoteador(async () => Promise.reject(new Error('sem sessão')), {
      historico: createMemoryHistory(),
      desenvolvimento: false,
    });
    const permissaoDaRota = (caminho: string) => {
      const x = r.resolve(caminho);
      if (x.name === 'nao-encontrada') return undefined;
      const m = [...x.matched].reverse().find((y) => y.meta?.permissao);
      return (m?.meta?.permissao as string | undefined) ?? undefined;
    };
    // As telas genéricas de consulta (/consultas/item/…) conferem a permissão do item na própria tela (M14).
    const doMarco = ARVORE_MENU.filter(
      (i) =>
        (i.id.startsWith('recepcao.atendimento.') || i.id.startsWith('pronto-atendimento.')) &&
        !i.rota?.startsWith('/consultas/item/'),
    );
    expect(doMarco.filter((i) => i.rota && i.permissao).length).toBeGreaterThanOrEqual(8);
    expect(itensComPermissaoDiferente(doMarco, permissaoDaRota)).toEqual([]);
  });
});

describe('W1-05: correção da ficha, recusas e dependentes', () => {
  const FICHA = {
    convenio: { codigo: 306, nome: 'CONVENIO SINTETICO' },
    especialidade: { codigo: 15, nome: 'CLINICA MEDICA' },
    profissional: { crm: 52001, nome: 'ANA MEDICA' },
    procedimento: { codigo: 10101012, nome: 'CONSULTA', valor: 100 },
    carater: 'eletivo',
  } as unknown as Parameters<typeof camposDaFicha>[0];

  it('a ficha preenche a correção com o vínculo da especialidade; nada mudou → null', () => {
    const c = camposDaFicha(FICHA, APOIO);
    expect(c).toMatchObject({
      convenio: '306',
      especialidade: '15',
      profissional: '7101',
      procedimento: '10101012',
      carater: 'eletivo',
      cidPrincipal: null,
      observacao: '',
    });
    expect(entradaDaCorrecao(c, c, 'qualquer motivo', 'v1')).toBeNull();
  });

  it('só vai o que mudou, com a justificativa aparada e o carimbo', () => {
    const antes = camposDaFicha(FICHA, APOIO);
    const agora: CamposCorrecao = {
      ...antes,
      convenio: '99',
      carater: 'urgencia',
      cidPrincipal: 42,
      solicitante: 7,
      observacao: '  trocada  ',
    };
    expect(entradaDaCorrecao(antes, agora, '  convênio errado na recepção ', '2026-11-19 10:00:00')).toEqual({
      convenio: 99,
      carater: 'urgencia',
      cidPrincipal: 42,
      solicitante: 7,
      observacao: 'trocada',
      justificativa: 'convênio errado na recepção',
      versao: '2026-11-19 10:00:00',
    });
  });

  it('revisão: o CID, o solicitante e a observação gravados preenchem a correção; retirar envia null', () => {
    const gravada = {
      ...FICHA,
      cidPrincipal: { id: 1, codigo: 'R509', nome: 'FEBRE' },
      cidSecundario: { id: 2, codigo: 'I10', nome: 'HIPERTENSAO' },
      solicitante: { id: 501, nome: 'DR UM', registro: '52100' },
      observacaoFicha: 'anotada na recepção',
    } as unknown as Parameters<typeof camposDaFicha>[0];
    const antes = camposDaFicha(gravada, APOIO);
    expect(antes).toMatchObject({
      cidPrincipal: 1,
      cidSecundario: 2,
      solicitante: 501,
      observacao: 'anotada na recepção',
    });
    // Nada mudou: o gravado não volta como alteração.
    expect(entradaDaCorrecao(antes, { ...antes }, 'qualquer motivo', 'v1')).toBeNull();
    // Remover o CID secundário, o solicitante e a observação envia null (o contrato limpa).
    expect(
      entradaDaCorrecao(
        antes,
        { ...antes, cidSecundario: null, solicitante: null, observacao: '   ' },
        'retirados por engano',
        'v1',
      ),
    ).toEqual({
      cidSecundario: null,
      solicitante: null,
      observacao: null,
      justificativa: 'retirados por engano',
      versao: 'v1',
    });
    // O CID principal só se troca (sem null); a observação editada vai inteira, partindo da anterior.
    expect(
      entradaDaCorrecao(
        antes,
        { ...antes, cidPrincipal: null, observacao: 'anotada na recepção; retorno em 7 dias' },
        'complemento da nota',
        'v1',
      ),
    ).toEqual({
      observacao: 'anotada na recepção; retorno em 7 dias',
      justificativa: 'complemento da nota',
      versao: 'v1',
    });
  });

  it('os dependentes da recusa (quantos e quais) saem do Problem Details com tolerância', () => {
    expect(
      dependentesDoErro({
        codigo: 'exclusao-recusada',
        dependentes: [
          { rotulo: 'Evolução', quantidade: 2, amostra: ['10', '11'], origem: 'logica' },
          { tabela: 'PRPRESC', quantidade: 1 },
          { rotulo: 'vazio', quantidade: 0 },
        ],
      }),
    ).toEqual([
      { rotulo: 'Evolução', quantidade: 2, amostra: ['10', '11'] },
      { rotulo: 'PRPRESC', quantidade: 1, amostra: [] },
    ]);
    expect(dependentesDoErro(null)).toEqual([]);
    expect(dependentesDoErro({ dependentes: 'x' })).toEqual([]);
  });

  it('toda recusa da correção, do estorno e da exclusão tem texto; conta fechada encaminha ao faturamento', () => {
    const r = mensagensAtendimento.recusas as Record<string, string>;
    for (const c of [
      'conta-fechada',
      'conta-apresentada',
      'conta-emitida',
      'conta-com-itens',
      'troca-de-conta',
      'procedimento-de-outro-ato',
      'procedimento-inexistente',
      'procedimento-do-sadt',
      'item-com-vinculo',
      'sem-item-na-conta',
      'data-fora-do-atendimento',
      'nada-a-corrigir',
      'nada-a-alterar',
      'solicitante-inexistente',
      'sem-titular',
      'exclusao-recusada',
    ])
      expect(r[c], c).toBeTruthy();
    for (const c of ['conta-fechada', 'conta-apresentada', 'conta-emitida'])
      expect(r[c]).toMatch(/faturamento/);
    expect(JSON.stringify(mensagensAtendimento)).not.toMatch(
      /só consulta|em consulta nesta|ainda está em consulta/i,
    );
  });

  it('hoje no fuso local (limite da data do extra)', () => {
    expect(hojeIso(new Date(2026, 10, 19, 23, 30))).toBe('2026-11-19');
  });
});
