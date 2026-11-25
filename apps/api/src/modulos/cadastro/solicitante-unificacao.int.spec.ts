// Contrato de efeito da unificação de solicitante externo duplicado (F3.1, 02-CAD linha 20) contra o MariaDB real, no
// cliente de teste f22_o1, com massa SINTÉTICA (prefixo F22L0102 UNI; nenhuma pessoa real). Prova o que fica no banco:
// o absorvido fica inativo, com o ponteiro para o cadastro que continua, e NÃO é apagado; o atendimento que o cita
// segue igual (mesmo solicitante, mesma versão); o código na fonte pagadora passa ao que continua só onde ele não
// tem código; quem já estava unificado no absorvido passa a apontar para o novo (sem cadeia); reativar o unificado é
// recusado; a trilha guarda o motivo; e desfazer devolve o ponteiro e reativa. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { CadastroLigacoesProprio } from './cadastro-ligacoes-proprio.js';
import {
  CLIENTE_F22,
  contextoPorta,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COR = 'f3-1-10-unificacao';
const NUMERO_AT = 'F3110-UNI-1';
const MOTIVO = 'mesmo médico digitado duas vezes';

describe.skipIf(SEM_BANCO)('unificação de solicitante externo no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let s: CadastroLigacoesProprio;
  let m: Massa | null = null;
  let fonte2 = 0;
  let atendimento = 0;
  // a: o que continua; b: o duplicado; c: outro duplicado (unificado antes em b); d: destino final da cadeia.
  let a = 0;
  let b = 0;
  let c3 = 0;
  let d = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.uma<T>(sql, p));
  const todos = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => l.consultar(sql, p));
  const t = (): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade: 'solicitante_externo',
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.ligacoes' },
    correlacao: COR,
  });
  const c = () => contextoPorta(m!, COR);
  const versao = async (id: number) =>
    Number(
      (await um<{ versao: unknown }>('SELECT versao FROM solicitante_externo WHERE id = ?', [id]))!.versao,
    );
  const linha = (id: number) =>
    um(
      `SELECT ativo, sucessor_solicitante_externo_id AS sucessor, unificado_em IS NOT NULL AS com_data, unificado_por,
              data_inativacao IS NOT NULL AS inativado, excluido_em FROM solicitante_externo WHERE id = ?`,
      [id],
    );
  const trilhaDe = async (id: number) => {
    const r = await um(
      `SELECT acao, motivo FROM trilha_auditoria WHERE entidade = 'solicitante_externo' AND entidade_id = ?
        ORDER BY id DESC LIMIT 1`,
      [id],
    );
    return r ? [r['acao'], r['motivo']] : null;
  };

  async function limparMinhas(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      await e.executar('DELETE FROM atendimento WHERE numero = ?', [NUMERO_AT]);
      await e.executar(
        `DELETE x FROM solicitante_externo_fonte_pagadora x JOIN solicitante_externo s ON s.id = x.solicitante_externo_id
          WHERE s.nome LIKE ?`,
        [`%${MARCA} UNI%`],
      );
      await e.executar(
        'UPDATE solicitante_externo SET sucessor_solicitante_externo_id = NULL, unificado_em = NULL, unificado_por = NULL WHERE nome LIKE ?',
        [`%${MARCA} UNI%`],
      );
      await e.executar('DELETE FROM solicitante_externo WHERE nome LIKE ?', [`%${MARCA} UNI%`]);
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparMinhas();
    s = new CadastroLigacoesProprio(nucleo, CLIENTE_F22);
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, async (e) => {
      const ids: number[] = [];
      for (const [nome, numero] of [
        [`BIA ${MARCA} UNI SINTETICA`, '9915001'],
        [`DRA BIA ${MARCA} UNI SINTETICA`, '9915002'],
        [`BIA ${MARCA} UNI SINTETICA REPETIDA`, '9915003'],
        [`BIA ${MARCA} UNI SINTETICA FINAL`, '9915004'],
      ] as const)
        ids.push(
          await e.inserir(
            `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
               data_inscricao, ativo, criado_em) VALUES (?, ?, ?, ?, '2026-01-01', TRUE, NOW(3))`,
            [nome, m!.conselho, numero, m!.uf],
          ),
        );
      [a, b, c3, d] = ids as [number, number, number, number];
      fonte2 = Number(
        (await e.uma<{ id: unknown }>(
          'SELECT MIN(id) AS id FROM fonte_pagadora WHERE id <> ? AND excluido_em IS NULL',
          [m!.fonte],
        ))!.id,
      );
      // b tem código nas duas fontes; a só na primeira (diferente): herda a segunda, mantém a sua na primeira.
      for (const [dono, fonte, codigo] of [
        [a, m!.fonte, 'A-1'],
        [b, m!.fonte, 'B-1'],
        [b, fonte2, 'B-2'],
      ] as const)
        await e.executar(
          `INSERT INTO solicitante_externo_fonte_pagadora (solicitante_externo_id, fonte_pagadora_id, codigo_na_fonte,
             ativo, criado_em) VALUES (?, ?, ?, TRUE, NOW(3))`,
          [dono, fonte, codigo],
        );
      // Atendimento sintético pedido pelo duplicado: o registro clínico que a unificação não pode alterar.
      const min = async (tabela: string) =>
        Number((await e.uma<{ id: unknown }>(`SELECT MIN(id) AS id FROM ${tabela}`, []))!.id);
      atendimento = await e.inserir(
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, solicitante_externo_id, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(3), NOW(3))`,
        [
          m!.estabelecimento,
          NUMERO_AT,
          await min('paciente'),
          await min('categoria_atendimento'),
          await min('carater_atendimento_tiss'),
          m!.fonte,
          m!.profissional,
          b,
        ],
      );
    });
  }, 120_000);

  afterAll(async () => {
    await limparMinhas();
    if (m)
      await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        limparTrilhaDaMassa(e, { ids: [m!.estabelecimento, m!.outroEstabelecimento] }),
      );
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('recusa o que a regra do domínio recusa, sem gravar nada', async () => {
    await expect(
      s.unificarSolicitante(c(), { mantido: a, absorvido: a, versao: await versao(a), motivo: MOTIVO }, t()),
    ).rejects.toMatchObject({ problema: { codigo: 'mesmo-cadastro' } });
    await expect(
      s.unificarSolicitante(c(), { mantido: a, absorvido: b, versao: await versao(b), motivo: 'curto' }, t()),
    ).rejects.toMatchObject({ problema: { codigo: 'motivo-curto' } });
    // Versão que a tela leu já passou: conflito, e não gravação por cima.
    await expect(
      s.unificarSolicitante(
        c(),
        { mantido: a, absorvido: b, versao: (await versao(b)) + 7, motivo: MOTIVO },
        t(),
      ),
    ).rejects.toBeTruthy();
    expect(Number((await linha(b))!['ativo'])).toBe(1);
    expect((await linha(b))!['sucessor']).toBeNull();
    expect(
      await todos('SELECT id FROM solicitante_externo_fonte_pagadora WHERE solicitante_externo_id = ?', [a]),
    ).toHaveLength(1);
  });

  it('unifica: o duplicado fica inativo com o ponteiro, o atendimento não muda e o código é herdado só onde falta', async () => {
    // Primeiro c é unificado em b; depois b em a: c passa a apontar para a (sem cadeia).
    await s.unificarSolicitante(
      c(),
      { mantido: b, absorvido: c3, versao: await versao(c3), motivo: MOTIVO },
      t(),
    );
    expect(Number((await linha(c3))!['sucessor'])).toBe(b);
    const antes = await um(
      'SELECT solicitante_externo_id, versao, alterado_em FROM atendimento WHERE id = ?',
      [atendimento],
    );

    const id = await s.unificarSolicitante(
      c(),
      { mantido: a, absorvido: b, versao: await versao(b), motivo: `  ${MOTIVO}  ` },
      t(),
    );
    expect(id).toBe(a);
    const lb = (await linha(b))!;
    expect(Number(lb['ativo'])).toBe(0);
    expect(Number(lb['sucessor'])).toBe(a);
    expect(Number(lb['com_data'])).toBe(1);
    expect(Number(lb['unificado_por'])).toBe(m!.usuario);
    expect(Number(lb['inativado'])).toBe(1);
    expect(lb['excluido_em']).toBeNull();
    expect(Number((await linha(c3))!['sucessor'])).toBe(a);
    expect(Number((await linha(a))!['ativo'])).toBe(1);
    expect((await linha(a))!['sucessor']).toBeNull();

    // O registro clínico segue como estava: mesmo solicitante da época, mesma versão, sem alteração.
    expect(
      await um('SELECT solicitante_externo_id, versao, alterado_em FROM atendimento WHERE id = ?', [
        atendimento,
      ]),
    ).toEqual(antes);
    expect(Number(antes!['solicitante_externo_id'])).toBe(b);

    // Códigos: a mantém o seu na primeira fonte e herda o da segunda; as linhas de b ficam.
    const cods = await todos(
      `SELECT solicitante_externo_id AS s, fonte_pagadora_id AS f, codigo_na_fonte AS c, ativo
         FROM solicitante_externo_fonte_pagadora WHERE solicitante_externo_id IN (?, ?) ORDER BY s, f`,
      [a, b],
    );
    const texto = cods.map(
      (x) => `${Number(x['s'])}|${Number(x['f'])}|${String(x['c'])}|${Number(x['ativo'])}`,
    );
    expect(texto.sort()).toEqual(
      [
        `${a}|${m!.fonte}|A-1|1`,
        `${a}|${fonte2}|B-2|1`,
        `${b}|${m!.fonte}|B-1|1`,
        `${b}|${fonte2}|B-2|1`,
      ].sort(),
    );
    expect(await trilhaDe(b)).toEqual(['operacao', MOTIVO]);

    // A ficha do que continua lista os unificados, com o atendimento que segue no duplicado; a do duplicado aponta.
    const fa = await s.fichaSolicitante(c(), a);
    expect(fa.unificadoEm).toBeNull();
    expect(fa.absorvidos.map((x) => [x.id, x.atendimentos]).sort()).toEqual(
      [
        [b, 1],
        [c3, 0],
      ].sort(),
    );
    expect(fa.parecidos.some((p) => p.id === b || p.id === c3)).toBe(false);
    const fb = await s.fichaSolicitante(c(), b);
    expect(fb.unificadoEm?.id).toBe(a);
    expect(fb.ativo).toBe(false);
  });

  it('o unificado não é reativado nem unificado de novo, e não recebe outro cadastro', async () => {
    await expect(
      s.mudarSituacaoSolicitante(
        c(),
        { id: b, versao: await versao(b), ativo: true, motivo: 'voltou a atender aqui', data: null },
        t(),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'solicitante-unificado' } });
    await expect(
      s.unificarSolicitante(c(), { mantido: d, absorvido: b, versao: await versao(b), motivo: MOTIVO }, t()),
    ).rejects.toMatchObject({ problema: { codigo: 'absorvido-ja-unificado' } });
    await expect(
      s.unificarSolicitante(c(), { mantido: b, absorvido: d, versao: await versao(d), motivo: MOTIVO }, t()),
    ).rejects.toMatchObject({ problema: { codigo: 'mantido-unificado' } });
    expect((await linha(d))!['sucessor']).toBeNull();
    // O banco também não aceita o ponteiro num cadastro ativo (CHECK), por fora da operação.
    await expect(
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        e.executar('UPDATE solicitante_externo SET sucessor_solicitante_externo_id = ? WHERE id = ?', [a, d]),
      ),
    ).rejects.toBeTruthy();
  });

  it('desfazer devolve o ponteiro e reativa, com o motivo na trilha; o que não está unificado é recusado', async () => {
    await expect(
      s.desfazerUnificacaoSolicitante(c(), { absorvido: d, versao: await versao(d), motivo: MOTIVO }, t()),
    ).rejects.toMatchObject({ problema: { codigo: 'nao-unificado' } });
    const id = await s.desfazerUnificacaoSolicitante(
      c(),
      { absorvido: b, versao: await versao(b), motivo: 'eram dois médicos diferentes' },
      t(),
    );
    expect(id).toBe(b);
    const lb = (await linha(b))!;
    expect(Number(lb['ativo'])).toBe(1);
    expect(lb['sucessor']).toBeNull();
    expect(Number(lb['com_data'])).toBe(0);
    expect(lb['unificado_por']).toBeNull();
    expect(Number(lb['inativado'])).toBe(0);
    expect(await trilhaDe(b)).toEqual(['operacao', 'eram dois médicos diferentes']);
    // c continua unificado em a (foi reapontado na unificação de b); o atendimento segue em b.
    expect(Number((await linha(c3))!['sucessor'])).toBe(a);
    expect(
      Number(
        (await um('SELECT solicitante_externo_id AS s FROM atendimento WHERE id = ?', [atendimento]))!['s'],
      ),
    ).toBe(b);
    expect((await s.fichaSolicitante(c(), a)).absorvidos.map((x) => x.id)).toEqual([c3]);
  });
});
