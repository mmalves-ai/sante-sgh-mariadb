// Contrato de efeito da unificação de solicitante externo duplicado (F3.1, 02-CAD linha 20) contra o MariaDB real, no
// cliente de teste f22_o1, com massa SINTÉTICA (prefixo F22L0102 UNI; nenhuma pessoa real). Prova o que fica no banco:
// o absorvido fica inativo, com o ponteiro para o cadastro que continua, e NÃO é apagado; o atendimento que o cita
// segue igual (mesmo solicitante, mesma versão); o código na fonte pagadora passa ao que continua só onde ele não
// tem código; quem já estava unificado no absorvido passa a apontar para o novo (sem cadeia); reativar o unificado é
// recusado; a trilha guarda o motivo; e desfazer devolve o ponteiro e a situação anterior (o que estava ativo volta
// ativo; o que já estava inativo continua inativo, com a mesma data de inativação). Prova também: os dados de
// identificação passam ao que continua só onde ele não tem; o registro novo (busca por CPF da internação pelo SUS e a
// leitura única do cadastro) vai para o cadastro que continua; e o que continua assume o registro do duplicado
// unificado nele, com a troca dos dois na mesma transação. SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { LeiturasAihPropria } from '../sus/porta-propria-aih.js';
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
import { solicitanteQueRespondeHoje } from './solicitante-vigente.js';
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
  // i: duplicado que já estava INATIVO antes da unificação; k: o que continua no caso da correção do registro;
  // j: o duplicado de k, que tem o número certo.
  let i = 0;
  let k = 0;
  let j = 0;
  // CPF sintético (inválido de propósito: dígitos repetidos com o sufixo da massa), só do duplicado b.
  const CPF_B = '00099915002';

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
        'UPDATE solicitante_externo SET sucessor_solicitante_externo_id = NULL, unificado_em = NULL, unificado_por = NULL, ativo_antes_unificacao = NULL WHERE nome LIKE ?',
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
        [`BIA ${MARCA} UNI SINTETICA INATIVA`, '9915005'],
        [`CAIO ${MARCA} UNI SINTETICO`, '9915006'],
        [`DR CAIO ${MARCA} UNI SINTETICO`, '9915007'],
      ] as const)
        ids.push(
          await e.inserir(
            `INSERT INTO solicitante_externo (nome, conselho_classe_id, numero_conselho, conselho_unidade_federativa_id,
               data_inscricao, ativo, criado_em) VALUES (?, ?, ?, ?, '2026-01-01', TRUE, NOW(3))`,
            [nome, m!.conselho, numero, m!.uf],
          ),
        );
      [a, b, c3, d, i, k, j] = ids as [number, number, number, number, number, number, number];
      // b tem CPF, telefone e e-mail; a tem só o e-mail (diferente): a recebe CPF e telefone e mantém o seu e-mail.
      await e.executar('UPDATE solicitante_externo SET cpf = ?, telefone = ?, email = ? WHERE id = ?', [
        CPF_B,
        '3100000002',
        'b@sintetico.test',
        b,
      ]);
      await e.executar('UPDATE solicitante_externo SET email = ? WHERE id = ?', ['a@sintetico.test', a]);
      // i já estava inativo, com a data de inativação dele.
      await e.executar(
        "UPDATE solicitante_externo SET ativo = FALSE, data_inativacao = '2026-03-10' WHERE id = ?",
        [i],
      );
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
    // Antes de unificar, a ficha do que continua já diz o que viria do duplicado e o que os dois têm diferente.
    const pb = (await s.fichaSolicitante(c(), a)).parecidos.find((p) => p.id === b)!;
    expect([...pb.traz].sort()).toEqual(['cpf', 'telefone']);
    expect(pb.difere).toEqual(['email']);

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

    // Identificação e contato: a recebeu de b só o que não tinha; o e-mail dele ficou; b segue com os seus dados.
    const dados = (id: number) =>
      um('SELECT cpf, telefone, email FROM solicitante_externo WHERE id = ?', [id]);
    expect(await dados(a)).toEqual({ cpf: CPF_B, telefone: '3100000002', email: 'a@sintetico.test' });
    expect(await dados(b)).toEqual({ cpf: CPF_B, telefone: '3100000002', email: 'b@sintetico.test' });

    // Registro novo vai para o cadastro que continua: a leitura única segue o ponteiro (b e c respondem por a), e a
    // busca por CPF da internação pelo SUS escolhe a, embora b (o duplicado) tenha o mesmo CPF.
    const hoje = (id: number) =>
      nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) => solicitanteQueRespondeHoje(l, id));
    expect(await hoje(b)).toBe(a);
    expect(await hoje(c3)).toBe(a);
    expect(await hoje(a)).toBe(a);
    expect(await hoje(d)).toBe(d);
    const porCpf = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) =>
      new LeiturasAihPropria(l, m!.estabelecimento).solicitantePorCpf(CPF_B),
    );
    expect(porCpf?.externo).toBe(a);
    // Tirando o CPF de a, só o duplicado tem o CPF: ainda assim o pedido novo nasce em a (segue o ponteiro).
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
      e.executar('UPDATE solicitante_externo SET cpf = NULL WHERE id = ?', [a]),
    );
    const soNoDuplicado = await nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: COR }, (l) =>
      new LeiturasAihPropria(l, m!.estabelecimento).solicitantePorCpf(CPF_B),
    );
    expect(soNoDuplicado?.externo).toBe(a);

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

  it('desfazer não reativa quem já estava inativo antes da unificação: mesma situação, mesma data de inativação', async () => {
    const situacao = (id: number) =>
      um(
        `SELECT ativo, DATE_FORMAT(data_inativacao, '%Y-%m-%d') AS inativacao, ativo_antes_unificacao AS antes,
                sucessor_solicitante_externo_id AS sucessor FROM solicitante_externo WHERE id = ?`,
        [id],
      );
    await s.unificarSolicitante(
      c(),
      { mantido: d, absorvido: i, versao: await versao(i), motivo: MOTIVO },
      t(),
    );
    // Unificado: guarda que estava inativo e NÃO troca a data de inativação original.
    const u = (await situacao(i))!;
    expect([Number(u['ativo']), u['inativacao'], Number(u['antes']), Number(u['sucessor'])]).toEqual([
      0,
      '2026-03-10',
      0,
      d,
    ]);
    await s.desfazerUnificacaoSolicitante(
      c(),
      { absorvido: i, versao: await versao(i), motivo: 'eram dois médicos diferentes' },
      t(),
    );
    const v = (await situacao(i))!;
    expect([Number(v['ativo']), v['inativacao'], v['antes'], v['sucessor']]).toEqual([
      0,
      '2026-03-10',
      null,
      null,
    ]);
    // E o que estava ativo guardou isso na unificação (b, desfeito acima, voltou ativo e sem a marca).
    expect((await situacao(b))!['antes']).toBeNull();
    // O banco não aceita a marca fora da unificação (CHECK).
    await expect(
      nucleo.escrever({ cliente: CLIENTE_F22, correlacao: COR }, (e) =>
        e.executar('UPDATE solicitante_externo SET ativo_antes_unificacao = TRUE WHERE id = ?', [d]),
      ),
    ).rejects.toBeTruthy();
  });

  it('o cadastro que continua assume o registro certo do duplicado unificado nele: os dois trocam de registro', async () => {
    const registro = async (id: number) =>
      String(
        (await um<{ n: unknown }>('SELECT numero_conselho AS n FROM solicitante_externo WHERE id = ?', [id]))!
          .n,
      );
    const alterar = async (id: number, numero: string) => {
      const f = await s.fichaSolicitante(c(), id);
      return s.alterarSolicitante(
        c(),
        {
          id,
          versao: f.versao,
          nome: f.nome,
          conselho: f.conselho,
          uf: f.uf,
          numero,
          cpf: f.cpf,
          cns: f.cns,
          ocupacao: f.ocupacao,
          especialidade: f.especialidade,
          instituicaoNome: f.instituicaoNome,
          instituicaoCnpj: f.instituicaoCnpj,
          instituicaoCnes: f.instituicaoCnes,
          telefone: f.telefone,
          email: f.email,
          observacao: f.observacao,
        },
        t(),
      );
    };
    // Antes de unificar, o número do outro cadastro é recusa (são dois cadastros vivos).
    await expect(alterar(k, '9915007')).rejects.toMatchObject({
      problema: { codigo: 'solicitante-existente' },
    });
    await s.unificarSolicitante(
      c(),
      { mantido: k, absorvido: j, versao: await versao(j), motivo: MOTIVO },
      t(),
    );
    // Depois: k assume o número de j, e j guarda o que k tinha (a chave única do banco segue valendo).
    await alterar(k, '9915007');
    expect(await registro(k)).toBe('9915007');
    expect(await registro(j)).toBe('9915006');
    expect(Number((await linha(j))!['sucessor'])).toBe(k);
    expect(Number((await linha(j))!['ativo'])).toBe(0);
    // O número de um cadastro de FORA continua recusado (d não foi unificado em k).
    await expect(alterar(k, '9915004')).rejects.toMatchObject({
      problema: { codigo: 'solicitante-existente' },
    });
    expect(await registro(k)).toBe('9915007');
    // Gravar de novo sem mudar o registro segue funcionando.
    await alterar(k, '9915007');
    expect(await registro(j)).toBe('9915006');
  });
});
