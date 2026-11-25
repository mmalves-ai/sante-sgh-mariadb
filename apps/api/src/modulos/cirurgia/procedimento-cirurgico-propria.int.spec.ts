// Contrato de efeito do cadastro do procedimento cirúrgico (F3.4, 04-CC linha 91) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: estabelecimento com o código do teste (para a sessão e a trilha), um grupo e dois portes
// fictícios (um em uso e um fora de uso), via de acesso, dois itens cobrados (um procedimento e
// uma taxa) e um procedimento SUS fictícios (código 99108900xx, fora da numeração oficial); usuário, especialidade,
// caráter, anestesia, classe de contaminação (uma por classe padronizada), grupo de faturamento e grupo SUS são ids já existentes do cliente de teste (só lidos, nunca
// alterados). Prova também a ligação com o faturamento (item cobrado e SUS gravados e lidos, item que não é
// procedimento recusado), as buscas do item cobrado e do SUS e as sugestões que a busca do agendamento devolve
// (buscarProcedimentosComSugestao: caráter, anestesia, duração média ou a de referência do porte). Prova o que fica no banco: a inclusão com o código em maiúsculas, os cadastros ligados
// (grupo, porte, especialidade, caráter) e origem 'sistema'; o código repetido recusado (409) sem linha nova; a regra
// do domínio (sem porte) e o porte fora de uso recusados (422) sem escrita; a alteração com a versão +1 e a versão
// velha recusada; tirar de uso e voltar sem apagar; a lista (busca, fora de uso só com "todos") e a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  buscarProcedimentosComSugestao,
  PortaProcedimentoCirurgicoPropria,
} from './procedimento-cirurgico-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1089pc';
const COD = 'C1089PC-001';

interface Massa {
  usuario: number;
  grupo: number;
  porte: number;
  porteInativo: number;
  especialidade: number;
  carater: number;
  anestesia: number;
  via: number;
  classe: number;
  item: number;
  itemTaxa: number;
  sigtap: number;
}

async function limpar(e: Escritor): Promise<void> {
  await e.executar('DELETE FROM procedimento_cirurgico WHERE codigo LIKE ?', ['C1089PC-%']);
  await e.executar('DELETE FROM porte_cirurgico WHERE codigo LIKE ?', [`${P}-%`]);
  await e.executar('DELETE FROM item_faturavel WHERE codigo LIKE ?', ['C1089PC-%']);
  await e.executar('DELETE FROM procedimento_sigtap WHERE codigo_sigtap LIKE ?', ['99108900%']);
  await e.executar('DELETE FROM via_acesso_cirurgico WHERE codigo LIKE ?', [`${P}-%`]);
  await e.executar('DELETE FROM grupo_procedimento_cirurgico WHERE codigo LIKE ?', [`${P}-%`]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)('PortaProcedimentoCirurgicoPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaProcedimentoCirurgicoPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const contar = async (codigo: string) =>
    Number(
      (await ler('SELECT COUNT(*) AS n FROM procedimento_cirurgico WHERE codigo = ?', [codigo]))[0]!['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const esp = await e.uma('SELECT MIN(id) AS id FROM especialidade_medica WHERE ativo = 1');
      const car = await e.uma('SELECT MIN(id) AS id FROM carater_cirurgia WHERE ativo = 1');
      const ane = await e.uma('SELECT MIN(id) AS id FROM tipo_anestesia WHERE ativo = 1');
      const cla = await e.uma('SELECT MIN(id) AS id FROM classe_contaminacao_cirurgica WHERE ativo = 1');
      const grupoFat = await e.uma('SELECT MIN(id) AS id FROM grupo_faturamento');
      const grupoSus = await e.uma('SELECT MIN(id) AS id FROM grupo_sigtap');
      for (const [nome, x] of Object.entries({ usuario, esp, car, ane, cla, grupoFat, grupoSus }))
        if (!x?.['id']) throw new Error(`O cliente de teste precisa de ${nome} em uso.`);
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const grupo = await e.inserir(
        'INSERT INTO grupo_procedimento_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-G`, 'GRUPO SINTETICO C1089', agora],
      );
      const porte = await e.inserir(
        `INSERT INTO porte_cirurgico (codigo, descricao, ativo, duracao_referencia_minutos, criado_em)
         VALUES (?, ?, 1, 120, ?)`,
        [`${P}-M`, 'PORTE SINTETICO C1089', agora],
      );
      const porteInativo = await e.inserir(
        'INSERT INTO porte_cirurgico (codigo, descricao, ativo, criado_em) VALUES (?, ?, 0, ?)',
        [`${P}-X`, 'PORTE SINTETICO FORA DE USO C1089', agora],
      );
      const via = await e.inserir(
        'INSERT INTO via_acesso_cirurgico (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        [`${P}-V`, 'VIA SINTETICA C1089', agora],
      );
      const itemCobrado = (codigo: string, tipo: string) =>
        e.inserir(
          `INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em)
           VALUES (?, ?, ?, ?, ?)`,
          [codigo, `ITEM SINTETICO ${codigo}`, tipo, Number(grupoFat!['id']), agora],
        );
      const item = await itemCobrado('C1089PC-I', 'procedimento');
      const itemTaxa = await itemCobrado('C1089PC-T', 'taxa');
      const sigtap = await e.inserir(
        `INSERT INTO procedimento_sigtap (codigo_sigtap, descricao, grupo_sigtap_id, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, ?, ?, '2026-01-01', 'sintetico', ?)`,
        ['9910890001', 'PROCEDIMENTO SUS SINTETICO C1089', Number(grupoSus!['id']), agora],
      );
      return {
        usuario: Number(usuario!['id']),
        grupo,
        porte,
        porteInativo,
        especialidade: Number(esp!['id']),
        carater: Number(car!['id']),
        anestesia: Number(ane!['id']),
        via,
        classe: Number(cla!['id']),
        item,
        itemTaxa,
        sigtap,
      };
    });
    porta = new PortaProcedimentoCirurgicoPropria(nucleo, CLIENTE);
  }, 60_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  const entrada = (extra: Record<string, unknown> = {}) => ({
    codigo: ` ${COD.toLowerCase()} `,
    descricao: 'Procedimento sintético C1089',
    mnemonico: 'SINT1089',
    natureza: 'terapeutica',
    grupo: m.grupo,
    porte: m.porte,
    especialidade: m.especialidade,
    carater: m.carater,
    tipoAnestesia: m.anestesia,
    viaAcesso: m.via,
    classeContaminacao: m.classe,
    itemFaturavel: m.item,
    procedimentoSigtap: m.sigtap,
    duracaoMediaMinutos: 90,
    tempoPreparoSalaMinutos: 20,
    exigeLateralidade: true,
    ...extra,
  });

  it('inclui com o código normalizado e os cadastros ligados; recusa repetido, sem porte e porte fora de uso', async () => {
    const a = await porta.incluir(ctx(), entrada());
    const [la] = await ler(
      `SELECT codigo, natureza, grupo_procedimento_cirurgico_id, porte_cirurgico_id, especialidade_medica_id,
              carater_cirurgia_id, tipo_anestesia_id, via_acesso_cirurgico_id, classe_contaminacao_cirurgica_id,
              item_faturavel_id, procedimento_sigtap_id, duracao_media_minutos, tempo_preparo_sala_minutos, exige_lateralidade, ativo,
              origem, versao, criado_por
         FROM procedimento_cirurgico WHERE id = ?`,
      [a.id],
    );
    expect(la).toMatchObject({ codigo: COD, natureza: 'terapeutica', origem: 'sistema' });
    expect(
      [
        'grupo_procedimento_cirurgico_id',
        'porte_cirurgico_id',
        'especialidade_medica_id',
        'carater_cirurgia_id',
        'tipo_anestesia_id',
        'via_acesso_cirurgico_id',
        'classe_contaminacao_cirurgica_id',
        'item_faturavel_id',
        'procedimento_sigtap_id',
        'duracao_media_minutos',
        'tempo_preparo_sala_minutos',
        'exige_lateralidade',
        'ativo',
        'versao',
        'criado_por',
      ].map((k) => Number(la![k])),
    ).toEqual([
      m.grupo,
      m.porte,
      m.especialidade,
      m.carater,
      m.anestesia,
      m.via,
      m.classe,
      m.item,
      m.sigtap,
      90,
      20,
      1,
      1,
      1,
      m.usuario,
    ]);
    const lido = await porta.obter(ctx(), a.id);
    expect([lido.itemFaturavel, lido.procedimentoSigtap, lido.viaAcesso, lido.classeContaminacao]).toEqual([
      m.item,
      m.sigtap,
      m.via,
      m.classe,
    ]);
    expect(lido.itemFaturavelCodigo).toBeTruthy();
    expect(lido.sigtapCodigo).toMatch(/^\d{10}$/);
    expect((await porta.buscarItensFaturaveis(ctx(), lido.itemFaturavelCodigo!)).map((x) => x.id)).toContain(
      m.item,
    );
    expect((await porta.buscarSigtap(ctx(), lido.sigtapCodigo!)).map((x) => x.id)).toContain(m.sigtap);
    expect(await porta.buscarSigtap(ctx(), 'x')).toEqual([]);
    const apoio = await porta.apoio(ctx());
    expect(apoio.vias.map((v) => v.id)).toContain(m.via);
    expect(apoio.classesContaminacao.map((v) => v.id)).toContain(m.classe);

    // Sugestões à busca do agendamento: as do cadastro e, sem duração média, a de referência do porte.
    await porta.incluir(
      ctx(),
      entrada({ codigo: 'C1089PC-003', carater: null, tipoAnestesia: null, duracaoMediaMinutos: null }),
    );
    const sugestoes = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) =>
      buscarProcedimentosComSugestao(l, 'Procedimento sintético C1089'),
    );
    expect(sugestoes.find((x) => x.codigo === a.id)).toMatchObject({
      carater: m.carater,
      anestesia: m.anestesia,
      duracaoMin: 90,
    });
    expect(sugestoes.find((x) => x.codigo !== a.id)).toMatchObject({
      carater: null,
      anestesia: null,
      duracaoMin: 120,
    });

    await expect(porta.incluir(ctx(), entrada())).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', porte: null }))).rejects.toMatchObject(
      { problema: { status: 422 } },
    );
    await expect(
      porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', porte: m.porteInativo })),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', itemFaturavel: m.itemTaxa })),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', procedimentoSigtap: 999_999_999 })),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await expect(
      porta.incluir(ctx(), entrada({ codigo: 'C1089PC-002', especialidade: 999_999_999 })),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await contar(COD)).toBe(1);
    expect(await contar('C1089PC-002')).toBe(0);
  });

  it('altera com a versão, recusa a versão velha, tira de uso e volta sem apagar; a lista e a trilha', async () => {
    const [x] = await ler('SELECT id FROM procedimento_cirurgico WHERE codigo = ?', [COD]);
    const id = Number(x!['id']);
    await porta.alterar(ctx(), id, {
      ...entrada({
        carater: null,
        duracaoMediaMinutos: 150,
        descricao: 'Procedimento sintético C1089 alterado',
      }),
      versao: 1,
    });
    const [lb] = await ler(
      'SELECT descricao, carater_cirurgia_id, duracao_media_minutos, versao FROM procedimento_cirurgico WHERE id = ?',
      [id],
    );
    expect(lb).toMatchObject({
      descricao: 'Procedimento sintético C1089 alterado',
      carater_cirurgia_id: null,
    });
    expect([Number(lb!['duracao_media_minutos']), Number(lb!['versao'])]).toEqual([150, 2]);
    await expect(porta.alterar(ctx(), id, { ...entrada(), versao: 1 })).rejects.toMatchObject({
      problema: { status: 409 },
    });

    await porta.definirUso(ctx(), id, { ativo: false, versao: 2 });
    const [lc] = await ler('SELECT ativo, versao, excluido_em FROM procedimento_cirurgico WHERE id = ?', [
      id,
    ]);
    expect([Number(lc!['ativo']), Number(lc!['versao']), lc!['excluido_em']]).toEqual([0, 3, null]);
    expect((await porta.listar(ctx(), { q: 'C1089PC' })).itens.map((i) => i.id)).not.toContain(id);
    const todos = await porta.listar(ctx(), { q: 'c1089pc', todos: true });
    expect(todos.itens.find((i) => i.id === id)).toMatchObject({
      ativo: false,
      porteDescricao: 'PORTE SINTETICO C1089',
      grupoDescricao: 'GRUPO SINTETICO C1089',
      textosPadrao: 0,
    });
    await porta.definirUso(ctx(), id, { ativo: true, versao: 3 });
    expect((await porta.obter(ctx(), id)).ativo).toBe(true);

    const apoio = await porta.apoio(ctx());
    expect(apoio.portes.map((p) => p.id)).toContain(m.porte);
    expect(apoio.portes.map((p) => p.id)).not.toContain(m.porteInativo);
    expect(apoio.portes.find((p) => p.id === m.porte)?.duracaoReferenciaMinutos).toBe(120);

    const [tr] = await ler(
      `SELECT COUNT(*) AS n FROM trilha_auditoria
        WHERE estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)`,
      [P],
    );
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(4);
  });
});
