// Contrato de efeito da apuração dos indicadores obrigatórios de internação (01-REL L112; F3) contra o MariaDB real
// (cliente de teste; massa SINTÉTICA com o código do teste, nenhuma pessoa real). Prova o que fica no banco: cada
// indicador obrigatório (ocupação, média de permanência, giro, intervalo de substituição, mortalidade geral e
// institucional) vira uma linha de apuracao_indicador por competência com numerador, denominador, valor, meta e
// situação; o indicador e a ficha vigente nascem da ficha do sistema quando o hospital não os tem; reapurar sem mudança
// não regrava; a prévia mudada é atualizada (versão sobe); a apuração fechada nunca é sobrescrita.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import type { BaseMensal } from '@sgh/contratos';
import { apurarIndicadoresInternacao, INDICADORES_OBRIGATORIOS_INTERNACAO } from '@sgh/dominio-relatorio';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  GRUPO_OBRIGATORIOS_INTERNACAO,
  PortaApuracaoInternacaoPropria,
} from './apuracao-internacao-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c2077ap';
const CODIGOS = [...INDICADORES_OBRIGATORIOS_INTERNACAO];

const base = (periodo: string, parcial: boolean, g: Partial<BaseMensal['grandezas']>): BaseMensal =>
  ({
    periodo,
    parcial,
    grandezas: {
      dias: 30,
      pacientesDia: 0,
      leitosDia: 0,
      pacientesDiaIntensiva: 0,
      leitosDiaIntensiva: 0,
      admissoes: 0,
      admissoesUrgencia: 0,
      saidas: 0,
      obitos: 0,
      obitosInstitucionais: 0,
      saidasVivas: 0,
      reinternacoes7: 0,
      reinternacoes30: 0,
      diariasFaturadas: 0,
      leitosOperacionaisMedios: 0,
      leitosDiaOciosos: 0,
      ...g,
    },
    altasPorGrupo: {},
  }) as unknown as BaseMensal;

const setembro = base('2026-09', false, {
  pacientesDia: 255,
  leitosDia: 300,
  saidas: 50,
  obitos: 3,
  obitosInstitucionais: 2,
  leitosOperacionaisMedios: 10,
  leitosDiaOciosos: 45,
});
const outubro = base('2026-10', false, {
  pacientesDia: 280,
  leitosDia: 310,
  saidas: 56,
  obitos: 1,
  leitosOperacionaisMedios: 10,
});

describe.skipIf(SEM_BANCO)('Apuração dos indicadores de internação (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaApuracaoInternacaoPropria;
  let usuario = 0;
  let previos: { indicadores: number[]; grupo: boolean } = { indicadores: [], grupo: false };
  const ctx = () => ({ cliente: CLIENTE, usuario, correlacao: P, hospital: P });
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p));
  const decimal = (v: unknown) => (v === null ? null : Number(v));
  const linhas = async () =>
    (
      await ler(
        `SELECT i.codigo, a.competencia, a.numerador, a.denominador, a.valor, a.valor_meta, a.situacao_meta, a.situacao, a.versao,
              a.indicador_versao_id, a.dados_ate IS NOT NULL AS com_data
         FROM apuracao_indicador a JOIN indicador i ON i.id = a.indicador_id
         JOIN estabelecimento e ON e.id = a.estabelecimento_id
        WHERE e.codigo = ? ORDER BY a.competencia, i.codigo`,
        [P],
      )
    ).map((r): Record<string, unknown> => ({
      ...r,
      numerador: decimal(r['numerador']),
      denominador: decimal(r['denominador']),
      valor: decimal(r['valor']),
      valor_meta: decimal(r['valor_meta']),
    }));

  async function limpar(e: Escritor, final: boolean): Promise<void> {
    await e.executar(
      'DELETE FROM apuracao_indicador WHERE estabelecimento_id IN (SELECT id FROM estabelecimento WHERE codigo = ?)',
      [P],
    );
    if (final) {
      const novos = (
        await e.consultar(
          `SELECT id FROM indicador WHERE codigo IN (${CODIGOS.map(() => '?').join(', ')})`,
          CODIGOS,
        )
      )
        .map((r) => Number(r['id']))
        .filter((id) => !previos.indicadores.includes(id));
      for (const id of novos) {
        await e.executar('DELETE FROM indicador_versao WHERE indicador_id = ?', [id]);
        await e.executar('DELETE FROM indicador WHERE id = ?', [id]);
      }
      if (!previos.grupo)
        await e.executar(
          'DELETE FROM grupo_indicador WHERE codigo = ? AND NOT EXISTS (SELECT 1 FROM indicador i WHERE i.grupo_indicador_id = grupo_indicador.id)',
          [GRUPO_OBRIGATORIOS_INTERNACAO],
        );
    }
    await limparTrilhaDaMassa(e, { codigos: [P] });
    await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    porta = new PortaApuracaoInternacaoPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e, false);
      previos = {
        indicadores: (
          await e.consultar(
            `SELECT id FROM indicador WHERE codigo IN (${CODIGOS.map(() => '?').join(', ')})`,
            CODIGOS,
          )
        ).map((r) => Number(r['id'])),
        grupo:
          (
            await e.consultar('SELECT id FROM grupo_indicador WHERE codigo = ?', [
              GRUPO_OBRIGATORIOS_INTERNACAO,
            ])
          ).length > 0,
      };
      const [u] = await e.consultar('SELECT id FROM usuario WHERE excluido_em IS NULL ORDER BY id LIMIT 1');
      usuario = Number(u!['id']);
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, 'Hospital Teste', 'Hospital sintético (fictício)', 'America/Sao_Paulo', NOW(3))`,
        [P],
      );
    });
  });

  afterAll(async () => {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, (e) => limpar(e, true));
    await nucleo.encerrar();
  });

  it('grava uma apuração por indicador e competência com numerador, denominador, valor, meta e situação', async () => {
    const r = await porta.apurar(
      ctx(),
      apurarIndicadoresInternacao([setembro, outubro], { taxaOcupacao: 80, mediaPermanencia: 4 }),
      new Date(),
    );
    expect(r).toMatchObject({ incluidas: 12, atualizadas: 0, mantidasFechadas: 0, semMudanca: 0 });
    const ls = await linhas();
    expect(ls).toHaveLength(12);
    const de = (codigo: string, mes: string) =>
      ls.find((x) => x['codigo'] === codigo && (x['competencia'] as Date).toISOString().startsWith(mes))!;
    expect(de('taxaOcupacao', '2026-09')).toMatchObject({
      numerador: 255,
      denominador: 300,
      valor: 85,
      valor_meta: 80,
      situacao_meta: 'na_meta',
      situacao: 'previa',
      versao: 1,
      com_data: 1,
    });
    expect(de('mediaPermanencia', '2026-09')).toMatchObject({
      numerador: 255,
      denominador: 50,
      valor: 5.1,
      situacao_meta: 'fora_da_meta',
    });
    expect(de('giroLeito', '2026-10')).toMatchObject({
      numerador: 56,
      denominador: 10,
      valor: 5.6,
      situacao_meta: 'sem_meta',
    });
    expect(de('taxaMortalidadeGeral', '2026-09')).toMatchObject({ numerador: 3, denominador: 50, valor: 6 });
    // O indicador e a ficha técnica vigente existem para cada código, com a grandeza do numerador.
    const fichas = await ler(
      `SELECT i.codigo, i.regulatorio, v.numero_versao, v.numerador_grandeza FROM indicador i
         JOIN indicador_versao v ON v.indicador_id = i.id
        WHERE i.codigo IN (${CODIGOS.map(() => '?').join(', ')})`,
      CODIGOS,
    );
    expect(new Set(fichas.map((f) => f['codigo']))).toEqual(new Set(CODIGOS));
    const trilha = await ler(`SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?`, [P]);
    expect(Number(trilha[0]!['n'])).toBeGreaterThan(0);
  });

  it('reapurar igual não regrava; a prévia mudada sobe a versão; a fechada nunca muda', async () => {
    const igual = await porta.apurar(
      ctx(),
      apurarIndicadoresInternacao([setembro, outubro], { taxaOcupacao: 80, mediaPermanencia: 4 }),
      new Date(),
    );
    expect(igual).toMatchObject({ incluidas: 0, atualizadas: 0, semMudanca: 12 });

    await nucleo.escrever({ cliente: CLIENTE, correlacao: `fechar-${P}` }, (e) =>
      e.executar(
        `UPDATE apuracao_indicador a JOIN indicador i ON i.id = a.indicador_id
            SET a.situacao = 'fechada', a.fechada_em = NOW(3), a.fechada_por_usuario_id = ?
          WHERE a.estabelecimento_id = (SELECT id FROM estabelecimento WHERE codigo = ?)
            AND a.competencia = '2026-09-01' AND i.codigo = 'taxaOcupacao'`,
        [usuario, P],
      ),
    );
    const setembroCorrigido = base('2026-09', false, { ...setembro.grandezas, pacientesDia: 270 });
    const r = await porta.apurar(
      ctx(),
      apurarIndicadoresInternacao([setembroCorrigido], { taxaOcupacao: 80, mediaPermanencia: 4 }),
      new Date(),
    );
    // Setembro: ocupação fechada fica; média de permanência muda (270 ÷ 50); giro, intervalo e mortalidades não mudam.
    expect(r).toMatchObject({ incluidas: 0, mantidasFechadas: 1, atualizadas: 1, semMudanca: 4 });
    const ls = await linhas();
    const set = (codigo: string) =>
      ls.find(
        (x) => x['codigo'] === codigo && (x['competencia'] as Date).toISOString().startsWith('2026-09'),
      )!;
    expect(set('taxaOcupacao')).toMatchObject({ numerador: 255, situacao: 'fechada', versao: 1 });
    expect(set('mediaPermanencia')).toMatchObject({
      numerador: 270,
      valor: 5.4,
      versao: 2,
      situacao: 'previa',
    });

    const lidas = await porta.lerApuracoes(ctx(), '2026-09');
    expect(lidas.map((x) => x.codigo).sort()).toEqual([...CODIGOS].sort());
    expect(lidas.find((x) => x.codigo === 'taxaOcupacao')).toMatchObject({
      numerador: 255,
      denominador: 300,
      situacao: 'fechada',
    });
  });
});
