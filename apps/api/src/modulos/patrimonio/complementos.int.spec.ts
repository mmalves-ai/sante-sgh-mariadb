// Contrato de efeito dos complementos do patrimônio (F8, 07-FIN linha 149) na porta própria contra o MariaDB real,
// cliente f22_o2, com massa SINTÉTICA: agregação (agregacao_bem, e a base da depreciação da competência seguinte),
// imobilizado em andamento (imobilizado_andamento, apropriacao_imobilizado_andamento e o bem gerado na ativação) e
// seguro (apolice_seguro, bem_segurado). Prova o que fica no banco, a trilha e as recusas sem gravar.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaComplementosPatrimonio } from './complementos-propria.js';
import {
  CLIENTE_PAT,
  contextoPat,
  encerrarMassaPatrimonio,
  type MassaPatrimonio,
  P_PAT,
  prepararMassaPatrimonio,
  SEM_BANCO_PAT,
  trilhaPat,
} from './massa.spec-util.js';
import { PortaPatrimonioPropria } from './porta-propria.js';

const MARCA = 'Q';
const PREFIXO = 'C2072';
const HOJE = '2026-11-25';

/** Apaga o que este arquivo gravou (antes da limpeza comum da massa, que apaga os bens). */
async function limpar(e: Escritor): Promise<void> {
  const ests = await e.consultar<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo IN (?, ?)', [
    `${P_PAT}${MARCA}`,
    `${P_PAT}${MARCA}X`,
  ]);
  if (!ests.length) return;
  const ids = ests.map((x) => Number(x.id));
  const em = ids.map(() => '?').join(', ');
  await e.executar(
    `DELETE s FROM bem_segurado s JOIN apolice_seguro a ON a.id = s.apolice_seguro_id WHERE a.estabelecimento_id IN (${em})`,
    ids,
  );
  await e.executar(
    `UPDATE apolice_seguro SET apolice_anterior_id = NULL WHERE estabelecimento_id IN (${em})`,
    ids,
  );
  await e.executar(`DELETE FROM apolice_seguro WHERE estabelecimento_id IN (${em})`, ids);
  await e.executar(
    `DELETE a FROM agregacao_bem a JOIN bem_patrimonial b ON b.id = a.bem_patrimonial_id WHERE b.estabelecimento_id IN (${em})`,
    ids,
  );
  await e.executar(
    `UPDATE bem_patrimonial SET bem_agregador_id = NULL, imobilizado_andamento_id = NULL WHERE estabelecimento_id IN (${em})`,
    ids,
  );
  await e.executar(
    `DELETE p FROM apropriacao_imobilizado_andamento p JOIN imobilizado_andamento o ON o.id = p.imobilizado_andamento_id
      WHERE o.estabelecimento_id IN (${em})`,
    ids,
  );
  await e.executar(`DELETE FROM imobilizado_andamento WHERE estabelecimento_id IN (${em})`, ids);
  await e.executar(`DELETE FROM titulo_pagar WHERE estabelecimento_id IN (${em}) AND numero LIKE ?`, [
    ...ids,
    `${PREFIXO}%`,
  ]);
}

describe.skipIf(SEM_BANCO_PAT)(
  'complementos do patrimônio na porta própria (MariaDB, cliente f22_o2)',
  () => {
    let m: MassaPatrimonio | null = null;
    let pat: PortaPatrimonioPropria;
    let porta: PortaComplementosPatrimonio;
    let bem = 0;
    let componente = 0;
    let grupo = 0;
    let conta = 0;
    let seguradora = 0;
    let titulo = 0;
    const nucleoLimpeza = new NucleoProprio();

    beforeAll(async () => {
      await nucleoLimpeza.escrever({ cliente: CLIENTE_PAT, correlacao: 'limpeza-c2072' }, limpar);
      m = await prepararMassaPatrimonio(MARCA);
      pat = new PortaPatrimonioPropria(m.nucleo, CLIENTE_PAT);
      porta = new PortaComplementosPatrimonio(m.nucleo, CLIENTE_PAT);
      const base = {
        empresa: 1,
        grupo: 'maquinas',
        origem: m.origem,
        documento: 'termo' as const,
        nota: null,
        itemNota: null,
        item: null,
        termo: { numero: 'T-C2072', data: '2025-01-05', doador: '' },
        dataAquisicao: '2025-01-05',
        residualCent: 0,
        vidaUtilMeses: 60,
        coeficiente: null,
        inicioDepreciacao: '2025-02',
        depreciavel: true,
        centro: m.centro1,
        localDetalhe: null,
        tipoResponsavel: null,
        responsavel: null,
        marca: null,
        modelo: null,
        numeroSerie: null,
      };
      const bens = await pat.cadastrar(
        contextoPat(m),
        {
          bens: [
            { ...base, plaqueta: 'C2072-B1', descricao: 'BEM SINTETICO PRINCIPAL', valorCent: 60_000_00 },
            { ...base, plaqueta: 'C2072-B2', descricao: 'BEM SINTETICO COMPONENTE', valorCent: 3_000_00 },
          ],
          item: null,
        },
        'l0211p.patrimonio',
        (n) => `C${n}`,
        trilhaPat(m, 'patrimonio.bem.cadastrado', 'bem_patrimonial', null),
      );
      bem = bens[0]!.id;
      componente = bens[1]!.id;
      const ids = await m.nucleo.escrever(
        { cliente: CLIENTE_PAT, correlacao: 'preparo-c2072' },
        async (e) => {
          const agora = new Date();
          const um = async (sql: string, p: unknown[] = []) =>
            Number((await e.uma<{ id: number }>(sql, p))?.id ?? 0);
          const g = await um("SELECT id FROM grupo_bem WHERE codigo = 'maquinas'");
          let k = await um("SELECT id FROM conta_contabil WHERE codigo_reduzido = 'C2072A'");
          if (!k) {
            let plano = await um("SELECT id FROM plano_contas WHERE codigo = 'C2072-PC'");
            if (!plano)
              plano = await e.inserir(
                "INSERT INTO plano_contas (codigo, descricao, tipo, mascara, quantidade_niveis, vigencia_inicio, criado_em) VALUES ('C2072-PC', 'PLANO SINTETICO C2072', 'contabil', '9.9.9.999', 4, '2000-01-01', ?)",
                [agora],
              );
            k = await e.inserir(
              `INSERT INTO conta_contabil (plano_contas_id, classificacao, codigo_reduzido, descricao, nivel, natureza,
             natureza_saldo, tipo, criado_em) VALUES (?, '1.9.9.072', 'C2072A', 'IMOBILIZADO EM ANDAMENTO SINTETICO', 4, 'ativo', 'devedora', 'analitica', ?)`,
              [plano, agora],
            );
          }
          const s =
            (await um('SELECT id FROM empresa_fornecedora WHERE razao_social = ?', [
              'SEGURADORA SINTETICA C2072',
            ])) ||
            (await e.inserir(
              "INSERT INTO empresa_fornecedora (tipo_pessoa, razao_social, cnpj, criado_em) VALUES ('juridica', ?, '00000000207201', ?)",
              ['SEGURADORA SINTETICA C2072', agora],
            ));
          const credor = await um('SELECT MIN(id) AS id FROM tipo_credor');
          const doc = await um('SELECT MIN(id) AS id FROM tipo_documento_financeiro');
          const nat = await um('SELECT MIN(id) AS id FROM natureza_financeira');
          const t = await e.inserir(
            `INSERT INTO titulo_pagar (estabelecimento_id, numero, tipo_credor_id, empresa_fornecedora_id, tipo_documento_financeiro_id,
           numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido, natureza_financeira_id, centro_custo_id,
           situacao, tipo_titulo, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, '2026-03-01', '2026-03-01', '80000.00', '80000.00', ?, ?, 'aberto', 'normal', ?)`,
            [m!.est, `${PREFIXO}1`, credor, s, doc, `${PREFIXO}1`, nat, m!.centro1, agora],
          );
          return { g, k, s, t };
        },
      );
      grupo = ids.g;
      conta = ids.k;
      seguradora = ids.s;
      titulo = ids.t;
      expect({ grupo, conta, seguradora, titulo }).toEqual({
        grupo: expect.any(Number),
        conta: expect.any(Number),
        seguradora: expect.any(Number),
        titulo: expect.any(Number),
      });
      expect(`${grupo}|${conta}|${seguradora}|${titulo}`).not.toMatch(/(^|\|)0(\||$)/);
    });

    afterAll(async () => {
      await nucleoLimpeza
        .escrever({ cliente: CLIENTE_PAT, correlacao: 'limpeza-c2072' }, limpar)
        .catch(() => undefined);
      await nucleoLimpeza.encerrar();
      await encerrarMassaPatrimonio(m);
    });

    const ler = <T>(sql: string, p: unknown[]) =>
      m!.nucleo.lerSomente({ cliente: CLIENTE_PAT, correlacao: 'c2072-leitura' }, (l) =>
        l.consultar(sql, p, { teto: 100 }),
      ) as Promise<T[]>;
    const trilhas = async (tabela: string, id: number) =>
      Number(
        (
          await ler<{ n: number }>(
            'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?',
            [tabela, id],
          )
        )[0]?.n ?? 0,
      );

    it('agregação: grava o componente e a melhoria, liga o componente, sobe a versão e entra na base seguinte', async () => {
      const c = contextoPat(m!);
      const antes = (await pat.bem(c, bem))!;
      const t = trilhaPat(m!, 'patrimonio.complemento.gravado', 'agregacao_bem', bem);
      // Recusa sem gravar: melhoria sem valor que soma ao custo.
      await expect(
        porta.agregar(
          contextoPat(m!),
          {
            bem,
            versao: antes.versao,
            tipo: 'melhoria',
            bemAgregado: null,
            nota: null,
            numeroDocumento: null,
            descricao: 'Melhoria sem valor',
            data: '2026-03-10',
            valorCent: 0,
            agregaValor: true,
            conta: null,
            observacao: null,
          },
          t,
          HOJE,
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'sem-valor' } });
      expect((await pat.bem(c, bem))!.versao).toBe(antes.versao);

      const r1 = await porta.agregar(
        contextoPat(m!),
        {
          bem,
          versao: antes.versao,
          tipo: 'melhoria',
          bemAgregado: null,
          nota: null,
          numeroDocumento: 'NF-SINT-1',
          descricao: 'Troca do motor por um de maior potência',
          data: '2026-03-10',
          valorCent: 5_000_00,
          agregaValor: true,
          conta,
          observacao: null,
        },
        t,
        HOJE,
      );
      const v1 = (await pat.bem(c, bem))!.versao;
      expect(v1).toBe(antes.versao + 1);
      const r2 = await porta.agregar(
        contextoPat(m!),
        {
          bem,
          versao: v1,
          tipo: 'componente',
          bemAgregado: componente,
          nota: null,
          numeroDocumento: null,
          descricao: 'Módulo acoplado ao equipamento',
          data: '2026-04-02',
          valorCent: 3_000_00,
          agregaValor: true,
          conta: null,
          observacao: null,
        },
        t,
        HOJE,
      );
      const linhas = await ler<Record<string, unknown>>(
        'SELECT sequencia, tipo, bem_agregado_id, valor, agrega_valor, data_desagregacao, criado_por FROM agregacao_bem WHERE bem_patrimonial_id = ? ORDER BY sequencia',
        [bem],
      );
      expect(linhas.map((l) => [Number(l['sequencia']), l['tipo'], String(l['valor'])])).toEqual([
        [1, 'melhoria', '5000.00'],
        [2, 'componente', '3000.00'],
      ]);
      expect(Number(linhas[1]!['bem_agregado_id'])).toBe(componente);
      expect(Number(linhas[0]!['criado_por'])).toBe(m!.usuario);
      const comp = await ler<Record<string, unknown>>(
        'SELECT bem_agregador_id FROM bem_patrimonial WHERE id = ?',
        [componente],
      );
      expect(Number(comp[0]!['bem_agregador_id'])).toBe(bem);
      expect(await trilhas('agregacao_bem', r1.id)).toBeGreaterThan(0);

      // A base da depreciação: abril tem só a melhoria (de março); maio, as duas.
      const base = async (comp: string) =>
        (await pat.bensParaDepreciar(contextoPat(m!), 1, comp)).bens.find((b) => b.id === bem)!.valorCent;
      expect(await base('2026-03')).toBe(60_000_00);
      expect(await base('2026-04')).toBe(65_000_00);
      expect(await base('2026-05')).toBe(68_000_00);

      // Retirada do componente: grava a data e o motivo, solta o componente, e sai da base dali em diante.
      const lida = await porta.agregacoes(contextoPat(m!), bem, HOJE);
      expect(lida.agregadoVigenteCent).toBe(8_000_00);
      const a2 = lida.agregacoes.find((a) => a.id === r2.id)!;
      await porta.retirarAgregacao(
        contextoPat(m!),
        { id: r2.id, versao: a2.versao, data: '2026-07-15', motivo: 'Módulo substituído' },
        t,
        HOJE,
      );
      await expect(
        porta.retirarAgregacao(
          contextoPat(m!),
          { id: r2.id, versao: a2.versao + 1, data: '2026-07-16', motivo: 'De novo, de novo' },
          t,
          HOJE,
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'ja-desagregado' } });
      const depois = await ler<Record<string, unknown>>(
        'SELECT a.data_desagregacao, a.excluido_em, b.bem_agregador_id FROM agregacao_bem a JOIN bem_patrimonial b ON b.id = a.bem_agregado_id WHERE a.id = ?',
        [r2.id],
      );
      expect(depois[0]!['data_desagregacao']).not.toBeNull();
      expect(depois[0]!['excluido_em']).toBeNull();
      expect(depois[0]!['bem_agregador_id']).toBeNull();
      expect(await base('2026-07')).toBe(68_000_00);
      expect(await base('2026-08')).toBe(65_000_00);
    });

    it('imobilizado em andamento: abre, apropria do título, recusa o repetido, ativa gerando o bem e não deixa cancelar', async () => {
      const t = trilhaPat(m!, 'patrimonio.complemento.gravado', 'imobilizado_andamento', null);
      const { id: obra, numero } = await porta.abrirObra(
        contextoPat(m!),
        {
          descricao: 'Ampliação sintética da ala',
          grupo,
          conta,
          centro: m!.centro1,
          dataInicio: '2026-02-01',
          dataPrevista: '2026-10-31',
          orcadoCent: 100_000_00,
          observacao: null,
        },
        t,
        HOJE,
      );
      expect(numero).toBeGreaterThan(0);
      let o = await porta.obra(contextoPat(m!), obra);
      expect(o).toMatchObject({
        situacao: 'em_andamento',
        acumuladoCent: 0,
        orcamento: { estado: 'dentro' },
      });
      const ap = await porta.apropriar(
        contextoPat(m!),
        {
          obra,
          versao: o.versao,
          data: '2026-03-05',
          titulo,
          nota: null,
          conta: null,
          descricao: 'Medição 1',
          valorCent: 80_000_00,
        },
        t,
        HOJE,
      );
      await expect(
        porta.apropriar(
          contextoPat(m!),
          {
            obra,
            versao: ap.versao,
            data: '2026-03-06',
            titulo,
            nota: null,
            conta: null,
            descricao: 'Repetida',
            valorCent: 80_000_00,
          },
          t,
          HOJE,
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'documento-repetido' } });
      await porta.apropriar(
        contextoPat(m!),
        {
          obra,
          versao: ap.versao,
          data: '2026-04-10',
          titulo,
          nota: null,
          conta: null,
          descricao: 'Medição 2',
          valorCent: 12_000_00,
        },
        t,
        HOJE,
      );
      o = await porta.obra(contextoPat(m!), obra);
      expect(o.acumuladoCent).toBe(92_000_00);
      expect(o.orcamento).toEqual({ percentual: 92, estado: 'alerta' });
      expect(o.apropriacoes!.map((a) => [a.sequencia, a.titulo, a.conta, a.valorCent])).toEqual([
        [1, titulo, conta, 80_000_00],
        [2, titulo, conta, 12_000_00],
      ]);
      await expect(
        porta.cancelarObra(contextoPat(m!), { obra, versao: o.versao, motivo: 'Projeto suspenso' }, t),
      ).rejects.toMatchObject({ problema: { codigo: 'com-custo' } });
      const at = await porta.ativar(
        contextoPat(m!),
        {
          obra,
          versao: o.versao,
          data: '2026-05-20',
          vidaUtilMeses: 300,
          plaqueta: 'C2072-OB1',
          origem: m!.origem,
          centro: null,
          residualCent: 0,
        },
        t,
        HOJE,
      );
      const bemGerado = await ler<Record<string, unknown>>(
        'SELECT valor_aquisicao, imobilizado_andamento_id, inicio_depreciacao, vida_util_meses, grupo_bem_id, situacao FROM bem_patrimonial WHERE id = ?',
        [at.bem],
      );
      expect(String(bemGerado[0]!['valor_aquisicao'])).toBe('92000.00');
      expect(Number(bemGerado[0]!['imobilizado_andamento_id'])).toBe(obra);
      expect(
        String(bemGerado[0]!['inicio_depreciacao']).slice(0, 7) === '2026-06' ||
          (bemGerado[0]!['inicio_depreciacao'] as Date).getMonth?.() === 5,
      ).toBe(true);
      expect(Number(bemGerado[0]!['grupo_bem_id'])).toBe(grupo);
      o = await porta.obra(contextoPat(m!), obra);
      expect(o).toMatchObject({
        situacao: 'ativado',
        dataAtivacao: '2026-05-20',
        bem: { id: at.bem, plaqueta: 'C2072-OB1' },
      });
      expect(await trilhas('imobilizado_andamento', obra)).toBeGreaterThan(0);
      // Ativada não recebe custo.
      await expect(
        porta.apropriar(
          contextoPat(m!),
          {
            obra,
            versao: o.versao,
            data: '2026-05-21',
            titulo,
            nota: null,
            conta: null,
            descricao: 'Depois',
            valorCent: 1_00,
          },
          t,
          HOJE,
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'nao-em-andamento' } });
      // A obra sem custo cancela com motivo e fica registrada.
      const { id: vazia } = await porta.abrirObra(
        contextoPat(m!),
        {
          descricao: 'Obra sintética desistida',
          grupo,
          conta,
          centro: null,
          dataInicio: '2026-06-01',
          dataPrevista: null,
          orcadoCent: null,
          observacao: null,
        },
        t,
        HOJE,
      );
      const ov = await porta.obra(contextoPat(m!), vazia);
      await porta.cancelarObra(
        contextoPat(m!),
        { obra: vazia, versao: ov.versao, motivo: 'Projeto suspenso' },
        t,
      );
      expect(await porta.obra(contextoPat(m!), vazia)).toMatchObject({ situacao: 'cancelado' });
    });

    it('seguro: inclui a apólice, segura o bem com o total, mostra o subseguro, retira e cancela sem apagar', async () => {
      const t = trilhaPat(m!, 'patrimonio.complemento.gravado', 'apolice_seguro', null);
      const nova = {
        numero: `${PREFIXO}-AP1`,
        tipo: 'equipamento',
        seguradora,
        corretorNome: null,
        corretorTelefone: null,
        corretorEmail: null,
        cobertura: 'Danos elétricos e roubo',
        inicio: '2026-01-01',
        fim: '2026-12-31',
        premioCent: 2_400_00,
        franquiaCent: 500_00,
        titulo: null,
        anterior: null,
      };
      const { id: ap } = await porta.incluirApolice(contextoPat(m!), nova, t);
      await expect(porta.incluirApolice(contextoPat(m!), nova, t)).rejects.toMatchObject({
        problema: { codigo: 'apolice-repetida' },
      });
      let a = await porta.apolice(contextoPat(m!), ap, HOJE);
      const s1 = await porta.segurarBem(
        contextoPat(m!),
        { apolice: ap, versao: a.versao, bem, valorSeguradoCent: 30_000_00, inicio: '2026-02-01' },
        t,
        HOJE,
      );
      await expect(
        porta.segurarBem(
          contextoPat(m!),
          { apolice: ap, versao: s1.versao, bem, valorSeguradoCent: 1_00, inicio: '2026-02-01' },
          t,
          HOJE,
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'bem-ja-segurado' } });
      a = await porta.apolice(contextoPat(m!), ap, HOJE);
      expect(a).toMatchObject({ totalSeguradoCent: 30_000_00, bensCobertos: 1, situacaoVista: 'vigente' });
      expect(a.bens![0]).toMatchObject({ bem, ativo: true, cobertura: { subseguro: true } });
      const linha = await ler<Record<string, unknown>>(
        'SELECT valor_segurado, vigencia_fim, ativo FROM bem_segurado WHERE id = ?',
        [s1.id],
      );
      expect(String(linha[0]!['valor_segurado'])).toBe('30000.00');

      await porta.retirarBem(
        contextoPat(m!),
        { id: s1.id, data: '2026-09-30', motivo: 'Bem enviado à manutenção externa' },
        t,
      );
      a = await porta.apolice(contextoPat(m!), ap, HOJE);
      expect(a).toMatchObject({ totalSeguradoCent: 0, bensCobertos: 0 });
      expect(a.bens![0]).toMatchObject({ ativo: false, fim: '2026-09-30' });
      const s2 = await porta.segurarBem(
        contextoPat(m!),
        { apolice: ap, versao: a.versao, bem: componente, valorSeguradoCent: 3_000_00, inicio: '2026-10-01' },
        t,
        HOJE,
      );
      await porta.cancelarApolice(
        contextoPat(m!),
        { id: ap, versao: s2.versao, motivo: 'Troca de seguradora' },
        t,
        HOJE,
      );
      const fim = await ler<Record<string, unknown>>(
        'SELECT a.situacao, a.valor_segurado_total, a.excluido_em, (SELECT COUNT(*) FROM bem_segurado s WHERE s.apolice_seguro_id = a.id) AS n, (SELECT COUNT(*) FROM bem_segurado s WHERE s.apolice_seguro_id = a.id AND s.ativo = TRUE) AS ativos FROM apolice_seguro a WHERE a.id = ?',
        [ap],
      );
      expect(fim[0]).toMatchObject({ situacao: 'cancelada', excluido_em: null });
      expect([Number(fim[0]!['n']), Number(fim[0]!['ativos'])]).toEqual([2, 0]);
      expect(await trilhas('apolice_seguro', ap)).toBeGreaterThan(0);
    });
  },
);
