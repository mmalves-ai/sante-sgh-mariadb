import { describe, expect, it } from 'vitest';
import { recursoDesligado } from '../liberacao/recursos.js';
import { ARVORE_MENU } from '../menu/arvore.js';
import { definicaoParametro } from '../parametros/definicoes.js';
import { CATALOGO_DECLARADO } from '../permissoes/catalogo.js';
import { PERMISSOES_M58_CODIGOS } from '../permissoes/desligamento.js';
import {
  diferencaItemDesligamento,
  MSG_EVIDENCIA_SEM_DADO_PESSOAL,
  CHAVE_ENTRADA_UTF8,
  CHARSETS_LEGADO,
  CONTAS_TECNICAS_DECLARADAS,
  esquemaPainelDesligamento,
  esquemaRegistrarItemDesligamento,
  FATIA_DO_PASSO,
  FUNCOES_EXTERNAS_ESPERADAS,
  INVENTARIO_DESLIGAMENTO,
  PARAMETRO_CHARSET_LEGADO,
  PASSOS_DESLIGAMENTO,
} from './desligamento.js';

const MENU = new Set(ARVORE_MENU.map((i) => i.id));

describe('desligamento (M58-F1): inventário e vocabulário', () => {
  it('cada item tem id único e item de menu que existe (as tabelas são conferidas em @sgh/legado)', () => {
    const ids = INVENTARIO_DESLIGAMENTO.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of INVENTARIO_DESLIGAMENTO) {
      if (i.substituto?.itemMenu) expect(MENU.has(i.substituto.itemMenu), i.id).toBe(true);
    }
  });

  it('os 4 itens que a ficha nomeia (regra 2) estão no inventário', () => {
    const ids = new Set(INVENTARIO_DESLIGAMENTO.map((i) => i.id));
    for (const id of ['aplicacao-estacoes', 'portal-resultados', 'paineis-tv', 'envio-agendado-relatorios']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('toda conta do fornecedor serve um item, e todo item com conta a declara', () => {
    const contas = new Map(CONTAS_TECNICAS_DECLARADAS.map((c) => [c.conta, c]));
    expect(contas.size).toBe(CONTAS_TECNICAS_DECLARADAS.length);
    for (const c of CONTAS_TECNICAS_DECLARADAS.filter((x) => x.destino === 'para-com-o-fornecedor')) {
      const item = INVENTARIO_DESLIGAMENTO.find((i) => i.id === c.item);
      expect(item?.contas, c.conta).toContain(c.conta);
    }
    for (const i of INVENTARIO_DESLIGAMENTO) {
      for (const c of i.contas) expect(contas.get(c)?.item, `${i.id}: ${c}`).toBe(i.id);
    }
    // backup e a API de integração da Hal-AI continuam depois do desligamento (cap-08 §8.10).
    expect(contas.get('SGHBACKUP')?.destino).toBe('continua');
    expect(contas.get('HAL_AI')?.destino).toBe('continua');
  });

  it('as 5 funções externas da cópia e os passos na ordem da ficha', () => {
    expect(FUNCOES_EXTERNAS_ESPERADAS.map((f) => f.nome)).toEqual([
      'LTRIM',
      'RTRIM',
      'STRLEN',
      'SUBSTR',
      'VLR_MED',
    ]);
    expect(PASSOS_DESLIGAMENTO).toEqual(['desligamento', 'firebird5', 'utf8']);
    expect(PASSOS_DESLIGAMENTO.map((p) => FATIA_DO_PASSO[p])).toEqual(['M58-F1', 'M58-F2', 'M58-F3']);
  });

  it('o parâmetro do charset, a chave da entrada sem restrição e as permissões estão nos catálogos', () => {
    const p = definicaoParametro(PARAMETRO_CHARSET_LEGADO);
    expect(p?.opcoes).toEqual([...CHARSETS_LEGADO]);
    expect(p?.padrao).toBe('CP1252');
    expect(p?.niveis).toEqual(['estabelecimento']);
    expect(p?.critico).toBe(true);
    const r = recursoDesligado(CHAVE_ENTRADA_UTF8);
    expect(r?.marco).toBe('M58');
    expect(r?.prerequisitos.map((x) => x.tipo)).toEqual(['aprovacao']);
    const codigos = new Set(CATALOGO_DECLARADO.map((x) => x.codigo));
    for (const c of Object.values(PERMISSOES_M58_CODIGOS)) expect(codigos.has(c), c).toBe(true);
    const registrar = CATALOGO_DECLARADO.find((x) => x.codigo === PERMISSOES_M58_CODIGOS.checklistRegistrar);
    expect(registrar?.criticidade).toBe('critica');
  });
});

describe('desligamento (M58-F1): contratos da API', () => {
  const base = {
    item: 'paineis-tv',
    situacao: 'substituto-em-uso',
    contingencia: 'reinstalavel-no-periodo',
    papelResponsavel: 'TI do hospital',
    evidencia: 'Chamado 123: TVs do 2º andar com token',
  } as const;

  it('o registro aceita item do inventário com situação decidida e recusa o resto', () => {
    expect(esquemaRegistrarItemDesligamento.safeParse(base).success).toBe(true);
    expect(esquemaRegistrarItemDesligamento.safeParse({ ...base, item: 'outro' }).success).toBe(false);
    expect(esquemaRegistrarItemDesligamento.safeParse({ ...base, situacao: 'pendente' }).success).toBe(false);
    expect(esquemaRegistrarItemDesligamento.safeParse({ ...base, evidencia: ' ' }).success).toBe(false);
    // Dado pessoal recusado (a mesma trava do registro versionado): CPF, prontuário de 7 dígitos, e-mail, telefone.
    for (const evidencia of [
      'paciente com CPF 123.456.789-09',
      'prontuário 1234567 do paciente',
      'falar com fulano@exemplo.com',
      'telefone 99999-0000',
    ]) {
      const r = esquemaRegistrarItemDesligamento.safeParse({ ...base, evidencia });
      expect(r.success, evidencia).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain(MSG_EVIDENCIA_SEM_DADO_PESSOAL);
    }
    expect(
      esquemaRegistrarItemDesligamento.safeParse({ ...base, papelResponsavel: 'TI, ramal 12345' }).success,
    ).toBe(false);
    expect(
      esquemaRegistrarItemDesligamento.safeParse({ ...base, papelResponsavel: 'ti@hospital.org' }).success,
    ).toBe(false);
    // fora do CP1252 (o banco ainda é CP1252 na F1)
    expect(esquemaRegistrarItemDesligamento.safeParse({ ...base, evidencia: 'ok 🙂 feito' }).success).toBe(
      false,
    );
  });

  it('o painel valida a forma completa', () => {
    const painel = {
      hospital: 'pc',
      em: '2026-10-24T12:00:00.000Z',
      sessoes: {
        janelaDias: 14,
        porDia: [{ dia: '2026-10-20', pessoas: 3 }],
        pessoasNaJanela: 3,
        diasSemSessao: 4,
        cumprido: false,
        cumpridoCap14: false,
      },
      itens: [
        {
          item: 'paineis-tv',
          tipo: 'painel',
          areaResponsavel: 'TI do hospital',
          situacao: 'pendente',
          contingencia: null,
          substituto: { marco: 'M19', itemMenu: null, aConfirmar: false },
          resolvido: false,
          pendencias: ['sem-registro'],
          registradoEm: null,
        },
      ],
      contas: {
        declaradas: [{ conta: 'SGHBACKUP', destino: 'continua', presente: true, escrita: true }],
        naoDeclaradas: 0,
      },
      plataforma: {
        versaoMotor: '3.0.14',
        versaoMaior: 3,
        ods: '12.0',
        charsetBanco: 'NONE',
        charsetParametro: 'CP1252',
        charsetConfere: true,
        funcoesExternas: [{ nome: 'VLR_MED', modulo: 'vlr_med', dependentes: 1, esperada: true }],
        impressao: null,
      },
      passos: [{ passo: 'desligamento', fatia: 'M58-F1', situacao: 'bloqueado', motivos: ['dp6-sem-data'] }],
      medidaDiaria: { diasLimpos: 0, exigidos: 14, paradaSemMedida: '2026-10-24', ultimaSessao: null },
      sessoesCumprido: false,
      ultimoDiaTabela: '2026-10-20',
      contasCombinadas: 0,
      fimRegistradoEm: null,
      dp6: { decididaEm: null, previstaPara: null },
      registro: 'docs/coexistencia/desligamento/pc.yaml',
      registroInvalido: null,
      podeRegistrar: true,
    };
    expect(esquemaPainelDesligamento.safeParse(painel).success).toBe(true);
    // O item sem papel e sem evidência sai com null (a forma do registro antigo continua válida).
    const p = esquemaPainelDesligamento.parse(painel);
    expect(p.itens[0]).toMatchObject({ papelResponsavel: null, evidencia: null });
  });
});

describe('desligamento (M58-F1): a diferença da trilha do registro de um item', () => {
  const novo = {
    situacao: 'substituto-em-uso',
    contingencia: 'nenhuma',
    papelResponsavel: 'TI do hospital',
    evidencia: 'ata do comitê',
  };
  it('guarda os códigos de antes e depois e só os nomes do texto livre alterado', () => {
    expect(
      diferencaItemDesligamento(
        {
          situacao: 'aceito-como-perdido',
          contingencia: 'reinstalavel-no-periodo',
          papelResponsavel: 'TI do hospital',
          evidencia: 'ata antiga',
        },
        novo,
      ),
    ).toBe(
      'situacao=aceito-como-perdido>substituto-em-uso;contingencia=reinstalavel-no-periodo>nenhuma;alterados=evidencia',
    );
    expect(diferencaItemDesligamento(null, novo)).toBe(
      'situacao=->substituto-em-uso;contingencia=->nenhuma;alterados=papel,evidencia',
    );
    expect(diferencaItemDesligamento({ ...novo }, novo)).toBe(
      'situacao=substituto-em-uso>substituto-em-uso;contingencia=nenhuma>nenhuma;alterados=nenhum',
    );
    expect(diferencaItemDesligamento(null, novo)).not.toContain('ata do comitê');
  });
});
