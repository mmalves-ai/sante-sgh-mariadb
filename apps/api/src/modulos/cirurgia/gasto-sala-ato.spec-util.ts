// Massa do contrato de efeito do gasto de sala do ato cirúrgico (04-CC linha 100), compartilhada pelos specs da gravação
// do ato (gasto-sala-propria.int.spec.ts e gasto-sala-lote-sem-validade.int.spec.ts). Massa SINTÉTICA: estoque da massa
// de suprimentos "F22L0314" e o ato com códigos "C0400"; nenhuma pessoa real.
import { type Escritor, type NucleoProprio } from '@sgh/nucleo';
import {
  CLIENTE,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
} from '../suprimentos/massa-propria.spec-util.js';

export const P = 'C0400';
const ESTS = `SELECT id FROM estabelecimento WHERE codigo LIKE 'F22L0314%'`;

export interface Massa {
  s: MassaSuprimentos;
  hospital: string;
  cirurgiao: number;
  outro: number;
  procedimento: number;
  ato: number;
  atoConcorrente: number;
  atoCancelado: number;
  loteOutroEst: number;
  kitOutroEst: number;
  /** Débito com conta aberta: o ato do segundo atendimento, a conta, o item faturável do produto com lote e o produto
   *  sem lote e sem item faturável (vai ao setor). */
  atoDebito: number;
  conta: number;
  faturavel: number;
  insumoSetor: number;
}

async function limpar(e: Escritor) {
  const atos = `SELECT id FROM ato_cirurgico WHERE estabelecimento_id IN (${ESTS})`;
  const gastos = `SELECT id FROM consumo_cirurgia WHERE ato_cirurgico_id IN (${atos})`;
  await e.executar(`DELETE FROM consumo_cirurgia_motivo WHERE consumo_cirurgia_id IN (${gastos})`, []);
  await e.executar(`DELETE FROM consumo_cirurgia_item WHERE consumo_cirurgia_id IN (${gastos})`, []);
  await e.executar(`DELETE FROM consumo_cirurgia WHERE ato_cirurgico_id IN (${atos})`, []);
  // A conta do débito (o movimento e o item da conta se apontam: solta o movimento antes; o movimento sai na massa).
  const contas = `SELECT id FROM conta_hospitalar WHERE estabelecimento_id IN (${ESTS})`;
  const itensConta = `SELECT id FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${contas})`;
  await e.executar(
    `UPDATE movimento_estoque SET conta_hospitalar_item_id = NULL WHERE conta_hospitalar_item_id IN (${itensConta})`,
    [],
  );
  await e.executar(
    `DELETE FROM conta_hospitalar_item_memoria WHERE conta_hospitalar_item_id IN (${itensConta})`,
    [],
  );
  await e.executar(`DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (${contas})`, []);
  await e.executar(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN (${ESTS})`, []);
  await e.executar(
    'UPDATE insumo SET item_faturavel_id = NULL WHERE item_faturavel_id IN (SELECT id FROM item_faturavel WHERE codigo LIKE ?)',
    [`${P}F%`],
  );
  await e.executar('DELETE FROM item_faturavel WHERE codigo LIKE ?', [`${P}F%`]);
  await e.executar(`DELETE FROM lista_material_procedimento WHERE estabelecimento_id IN (${ESTS})`, []);
  await e.executar(
    `DELETE FROM kit_material_item WHERE kit_material_id IN (SELECT id FROM kit_material WHERE codigo LIKE ?)`,
    [`${P}%`],
  );
  await e.executar('DELETE FROM kit_material WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar(`DELETE FROM participante_cirurgia WHERE ato_cirurgico_id IN (${atos})`, []);
  await e.executar(`DELETE FROM ato_cirurgico_procedimento WHERE ato_cirurgico_id IN (${atos})`, []);
  await e.executar(`DELETE FROM ato_cirurgico WHERE estabelecimento_id IN (${ESTS})`, []);
}

async function montar(s: MassaSuprimentos, e: Escritor): Promise<Massa> {
  const agora = new Date();
  const g = async (sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const est = s.estA;
  const hospital = String(
    (await e.uma<{ codigo: string }>('SELECT codigo FROM estabelecimento WHERE id = ?', [est]))!.codigo,
  );
  const pessoa = (nome: string) =>
    g(
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      [nome],
      'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
      [nome, agora],
    );
  const prof = async (nome: string) => {
    const pf = await pessoa(nome);
    return g(
      'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
      [pf],
      "INSERT INTO profissional (pessoa_fisica_id, tipo, atua_cirurgiao, criado_em) VALUES (?, 'corpo_clinico', TRUE, ?)",
      [pf, agora],
    );
  };
  const cad = (tabela: string, codigo: string, extra: Record<string, unknown> = {}) => {
    const ks = Object.keys(extra);
    return g(
      `SELECT id FROM ${tabela} WHERE codigo = ?`,
      [codigo],
      `INSERT INTO ${tabela} (codigo, descricao${ks.map((k) => `, ${k}`).join('')}, criado_em) VALUES (?, ?${ks.map(() => ', ?').join('')}, ?)`,
      [codigo, `${codigo} SINTETICO`, ...ks.map((k) => extra[k]), agora],
    );
  };
  const pf = await pessoa(`PACIENTE SINTETICO ${P}`);
  const paciente = await g(
    'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
    [pf],
    "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, 930400, 'ativo', ?)",
    [pf, agora],
  );
  const cirurgiao = await prof(`CIRURGIAO SINTETICO ${P}`);
  const outro = await prof(`OUTRO CIRURGIAO SINTETICO ${P}`);
  const anestesista = await prof(`ANESTESISTA SINTETICO ${P}`);
  const convenio = await g(
    'SELECT id FROM fonte_pagadora WHERE codigo = ?',
    [P],
    "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, ?, 'operadora', 'ativa', ?)",
    [P, `OPERADORA ${P}`, agora],
  );
  const categoria = await g(
    'SELECT id FROM categoria_atendimento WHERE codigo = ?',
    [`${P}int`],
    "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, 'CATEGORIA SINTETICA', 'internacao', ?)",
    [`${P}int`, agora],
  );
  const caraterTiss = await g(
    'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
    [`${P}c`],
    "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES (?, 'CARATER SINTETICO', 'teste', ?)",
    [`${P}c`, agora],
  );
  const carater = Number(
    (await e.uma<{ id: number }>('SELECT id FROM carater_cirurgia ORDER BY id LIMIT 1'))!.id,
  );
  const funcao = await cad('funcao_equipe_cirurgica', `${P}-CIR`, {
    funcao_medica: true,
    grau_participacao_tiss: '00',
  });
  const funcaoAnestesia = await cad('funcao_equipe_cirurgica', `${P}-ANE`, {
    funcao_medica: true,
    grau_participacao_tiss: '06',
  });
  const procedimento = await cad('procedimento_cirurgico', `${P}P1`);
  // Sem conta aberta de propósito: o débito tem de ser recusado (o débito com conta fica para o contrato do débito).
  const atendimento = await g(
    'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
    [est, `${P}-AT`],
    `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
       fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [est, `${P}-AT`, paciente, categoria, caraterTiss, convenio, cirurgiao, agora, agora],
  );
  const ua = await g(
    'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? AND codigo = ?',
    [est, 'CC1'],
    "INSERT INTO unidade_assistencial (estabelecimento_id, codigo, nome, tipo_unidade, criado_em) VALUES (?, 'CC1', 'BLOCO SINTETICO', 'centro_cirurgico', ?)",
    [est, agora],
  );
  const uc = await g(
    'SELECT id FROM unidade_cirurgica WHERE unidade_assistencial_id = ?',
    [ua],
    'INSERT INTO unidade_cirurgica (estabelecimento_id, unidade_assistencial_id, funciona_24_horas, criado_em) VALUES (?, ?, TRUE, ?)',
    [est, ua, agora],
  );
  const sala = await g(
    'SELECT id FROM sala_cirurgica WHERE estabelecimento_id = ? AND codigo = ?',
    [est, 'S1'],
    "INSERT INTO sala_cirurgica (estabelecimento_id, unidade_cirurgica_id, codigo, descricao, situacao, criado_em) VALUES (?, ?, 'S1', 'SALA SINTETICA 1', 'ativa', ?)",
    [est, uc, agora],
  );
  // O segundo atendimento, com conta aberta, recebe o débito do gasto de sala.
  const atendimentoConta = await g(
    'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
    [est, `${P}-AT2`],
    `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
       fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [est, `${P}-AT2`, paciente, categoria, caraterTiss, convenio, cirurgiao, agora, agora],
  );
  const tipoConta = Number((await e.uma<{ id: number }>('SELECT MIN(id) AS id FROM tipo_conta'))!.id);
  const conta = await e.inserir(
    `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id, tipo_conta_id,
       natureza, competencia, inicio_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, 'internacao', ?, ?, ?)`,
    [
      est,
      `${P}-C${Date.now() % 1e6}`,
      atendimentoConta,
      paciente,
      convenio,
      tipoConta,
      `${agora.toISOString().slice(0, 7)}-01`,
      agora,
      agora,
    ],
  );
  const grupoFat = await g(
    'SELECT id FROM grupo_faturamento WHERE codigo = ?',
    [`${P}GF`],
    "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, 'MATERIAL SINTETICO', 'material', ?)",
    [`${P}GF`, agora],
  );
  const faturavel = await e.inserir(
    `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, insumo_id, criado_em)
     VALUES (?, 'MATERIAL SINTETICO DO GASTO', 'material', ?, ?, ?)`,
    [`${P}F1`, grupoFat, s.insumo, agora],
  );
  await e.executar('UPDATE insumo SET item_faturavel_id = ? WHERE id = ?', [faturavel, s.insumo]);
  // O produto sem lote e sem item faturável, com saldo no local do gasto: vai ao setor (centro de custo do local). Grupo
  // e unidade próprios: o produto sai depois da massa, que apaga os dela.
  const grupoSetor = await inserirMinimo(e, 'grupo_insumo', { codigo: `${P}GS`, natureza: 'material' }, P);
  const unidadeSetor = await inserirMinimo(e, 'unidade_medida', { codigo: `${P}US` }, P);
  const insumoSetor = await inserirMinimo(
    e,
    'insumo',
    {
      codigo: `${P}N${Date.now() % 1e6}`,
      nome: 'ITEM SINTETICO DO SETOR',
      tipo: 'material',
      grupo_insumo_id: grupoSetor,
      estoque_unidade_medida_id: unidadeSetor,
      situacao: 'ativo',
    },
    P,
  );
  await inserirMinimo(
    e,
    'saldo_estoque',
    {
      estabelecimento_id: est,
      local_estoque_id: s.localA,
      insumo_id: insumoSetor,
      quantidade: 5,
      quantidade_consignada: 0,
      custo_medio: 1.5,
    },
    P,
  );
  let n = 0;
  const novoAto = async (situacao: string, atd = atendimento) => {
    const ato = await e.inserir(
      `INSERT INTO ato_cirurgico (estabelecimento_id, numero, atendimento_id, paciente_id, sala_cirurgica_id, carater_cirurgia_id,
         entrada_sala_em, inicio_cirurgia_em, fim_cirurgia_em, saida_sala_em, situacao, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        est,
        `${P}-${Date.now() % 1e6}-${++n}`,
        atd,
        paciente,
        sala,
        carater,
        agora,
        agora,
        agora,
        agora,
        situacao,
        agora,
      ],
    );
    await e.inserir(
      'INSERT INTO ato_cirurgico_procedimento (ato_cirurgico_id, sequencia, procedimento_cirurgico_id, principal, criado_em) VALUES (?, 1, ?, TRUE, ?)',
      [ato, procedimento, agora],
    );
    // A equipe: o cirurgião (grau 00) e o anestesista (grau 06); o outro cirurgião não está na equipe.
    await e.inserir(
      'INSERT INTO participante_cirurgia (ato_cirurgico_id, sequencia, profissional_id, funcao_equipe_cirurgica_id, criado_em) VALUES (?, 1, ?, ?, ?)',
      [ato, cirurgiao, funcao, agora],
    );
    await e.inserir(
      'INSERT INTO participante_cirurgia (ato_cirurgico_id, sequencia, profissional_id, funcao_equipe_cirurgica_id, criado_em) VALUES (?, 2, ?, ?, ?)',
      [ato, anestesista, funcaoAnestesia, agora],
    );
    return ato;
  };
  const loteOutroEst = await inserirMinimo(
    e,
    'lote_insumo',
    {
      estabelecimento_id: s.estB,
      insumo_id: s.insumo,
      numero_lote: `${P}LB`,
      validade: '2027-06-30',
      situacao: 'liberado',
    },
    P,
  );
  const kitOutroEst = await inserirMinimo(
    e,
    'kit_material',
    { estabelecimento_id: s.estB, codigo: `${P}KB`, nome: 'KIT B' },
    P,
  );
  return {
    s,
    hospital,
    cirurgiao,
    outro,
    procedimento,
    ato: await novoAto('realizado'),
    atoConcorrente: await novoAto('realizado'),
    atoCancelado: await novoAto('cancelado'),
    loteOutroEst,
    kitOutroEst,
    atoDebito: await novoAto('realizado', atendimentoConta),
    conta,
    faturavel,
    insumoSetor,
  };
}

/** O produto do setor sai antes da massa, com o próprio movimento, o item do documento e o saldo. */
async function limparProdutoSetor(nucleo: NucleoProprio) {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, async (e) => {
    const ins = 'SELECT id FROM insumo WHERE codigo LIKE ?';
    // O item do documento e o movimento se apontam: solta o item antes.
    await e.executar(
      `UPDATE documento_estoque_item SET movimento_estoque_id = NULL WHERE insumo_id IN (${ins})`,
      [`${P}N%`],
    );
    for (const t of ['movimento_estoque', 'documento_estoque_item', 'saldo_estoque'])
      await e.executar(`DELETE FROM ${t} WHERE insumo_id IN (${ins})`, [`${P}N%`]);
    await e.executar('DELETE FROM insumo WHERE codigo LIKE ?', [`${P}N%`]);
    await e.executar('DELETE FROM grupo_insumo WHERE codigo = ?', [`${P}GS`]);
    await e.executar('DELETE FROM unidade_medida WHERE codigo = ?', [`${P}US`]);
  });
}

/** Monta o ato da massa (limpa antes o que sobrou de execução anterior) e devolve a massa do gasto de sala. */
export async function montarAto(nucleo: NucleoProprio): Promise<Massa> {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, limpar).catch(() => undefined);
  await limparProdutoSetor(nucleo).catch(() => undefined);
  const s = await montarMassa(nucleo);
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-massa` }, async (e) => {
    await limpar(e);
    return montar(s, e);
  });
}

/** Desfaz o ato, o produto do setor e a massa de suprimentos. */
export async function desmontarAto(nucleo: NucleoProprio, m: Massa): Promise<void> {
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-limpa` }, limpar);
  await limparProdutoSetor(nucleo);
  await limparMassa(nucleo, m.s);
}
