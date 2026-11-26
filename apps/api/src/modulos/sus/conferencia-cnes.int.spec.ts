// Contrato de efeito da conferência com a base oficial do cadastro nacional (C3-011, 02-CAD linha 29): a conferência
// grava uma remessa_cnes de tipo 'conferencia' (numerada por competência) e uma critica_cnes por divergência; resolver
// marca quem e quando. Massa sintética (número nacional 9999973, códigos 9873 e q97/q01) apagada no fim.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaEstabelecimentoSusPropria } from './estabelecimento-sus-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c3011cnes';
const FONTE = 'c3011';
const CNES = '9999973';
const COMP = '2026-10-01';

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  await e.executar(
    `DELETE FROM critica_cnes WHERE remessa_cnes_id IN (SELECT id FROM remessa_cnes WHERE estabelecimento_id IN ${est})`,
    [P],
  );
  await e.executar(`DELETE FROM remessa_cnes WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM habilitacao_estabelecimento WHERE estabelecimento_id IN ${est}`, [P]);
  await e.executar(`DELETE FROM servico_classificacao_estabelecimento WHERE estabelecimento_id IN ${est}`, [
    P,
  ]);
  for (const t of ['estabelecimento', 'habilitacao', 'servico', 'leito'])
    await e.executar(`DELETE FROM ${t}_cadastro_nacional WHERE codigo_cnes = ?`, [CNES]);
  await e.executar("DELETE FROM habilitacao_sus WHERE codigo_cnes = '9873'");
  await e.executar('DELETE FROM habilitacao_sigtap WHERE versao_fonte = ?', [FONTE]);
  await e.executar('DELETE FROM servico_classificacao WHERE versao_fonte = ?', [FONTE]);
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

describe.skipIf(SEM_BANCO)(
  'Conferência com o cadastro nacional contra o MariaDB (contrato de efeito)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaEstabelecimentoSusPropria;
    let m: { est: number; usuario: number; serv: number };
    const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
    const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
        await limpar(e);
        const agora = new Date();
        const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
        if (!usuario?.['id']) throw new Error('O cliente de teste precisa de usuário.');
        const est = await e.inserir(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, cnpj, fuso_horario, criado_em)
         VALUES (?, 'Hospital sintético C3-011', 'Hospital sintético C3-011 (fictício)', ?, '00000000000191',
                 'America/Sao_Paulo', ?)`,
          [P, CNES, agora],
        );
        await e.inserir(
          `INSERT INTO habilitacao_sigtap (tipo, codigo_habilitacao, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('habilitacao', '9873', 'Habilitação sintética C3-011', '1999-01-01', ?, ?)`,
          [FONTE, agora],
        );
        const serv = await e.inserir(
          `INSERT INTO servico_classificacao (codigo_servico_cnes, codigo_classificacao_cnes, descricao_servico, descricao,
                versao_fonte, criado_em)
         VALUES ('997', '001', 'Serviço sintético C3-011', 'Classificação sintética', ?, ?)`,
          [FONTE, agora],
        );
        // Base oficial sintética da competência: a habilitação 9873 e o serviço 996/001 (o local tem 997/001), 2 leitos.
        await e.inserir(
          `INSERT INTO estabelecimento_cadastro_nacional (competencia, codigo_cnes, cnpj, razao_social, versao_fonte, criado_em)
         VALUES (?, ?, '00000000000191', 'HOSPITAL SINTETICO', '202610', ?)`,
          [COMP, CNES, agora],
        );
        await e.inserir(
          `INSERT INTO habilitacao_cadastro_nacional (competencia, codigo_cnes, codigo_habilitacao, competencia_inicio,
                versao_fonte, criado_em) VALUES (?, ?, '9873', '2015-01-01', '202610', ?)`,
          [COMP, CNES, agora],
        );
        await e.inserir(
          `INSERT INTO servico_cadastro_nacional (competencia, codigo_cnes, codigo_servico, codigo_classificacao,
                versao_fonte, criado_em) VALUES (?, ?, '996', '001', '202610', ?)`,
          [COMP, CNES, agora],
        );
        await e.inserir(
          `INSERT INTO leito_cadastro_nacional (competencia, codigo_cnes, codigo_tipo_leito, codigo_leito,
                quantidade_existente, quantidade_sus, versao_fonte, criado_em) VALUES (?, ?, '3', '74', 2, 1, '202610', ?)`,
          [COMP, CNES, agora],
        );
        return { est, usuario: Number(usuario['id']), serv };
      });
      porta = new PortaEstabelecimentoSusPropria(nucleo, CLIENTE);
    });

    afterAll(async () => {
      if (!nucleo) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    });

    it('confere: remessa de conferência numerada e uma crítica por divergência, em sequência', async () => {
      await porta.incluirServico(ctx(), { servicoClassificacao: m.serv, vigenciaInicio: '2026-01-01' });
      const r = await porta.conferirComCnes(ctx(), { competencia: '202610' });
      expect(r.resumo).toEqual({ erro: 1, alerta: 2, informacao: 1 });
      const [rem] = await ler(
        `SELECT tipo, situacao, numero_remessa, quantidade_criticas, competencia, responsavel_usuario_id,
              gerada_em IS NOT NULL AS gerada FROM remessa_cnes WHERE id = ? AND estabelecimento_id = ?`,
        [r.id, m.est],
      );
      expect(rem).toMatchObject({
        tipo: 'conferencia',
        situacao: 'conferida',
        numero_remessa: 1,
        quantidade_criticas: 4,
        responsavel_usuario_id: m.usuario,
      });
      expect(Number(rem!['gerada'])).toBe(1);
      const crit = await ler<{ sequencia: number; categoria: string; gravidade: string; resolvida: number }>(
        'SELECT sequencia, categoria, gravidade, resolvida FROM critica_cnes WHERE remessa_cnes_id = ? ORDER BY sequencia',
        [r.id],
      );
      expect(crit.map((c) => `${c.sequencia}:${c.categoria}:${c.gravidade}:${Number(c.resolvida)}`)).toEqual([
        '1:estabelecimento:alerta:0',
        '2:servico:erro:0',
        '3:servico:alerta:0',
        '4:leito:informacao:0',
      ]);
      const lidas = await porta.conferenciasCnes(ctx());
      expect(lidas[0]).toMatchObject({
        id: r.id,
        competencia: '202610',
        numeroRemessa: 1,
        quantidadeCriticas: 4,
      });
      expect(lidas[0]!.criticas).toHaveLength(4);
    });

    it('conferir de novo na competência abre a remessa 2; competência inválida é recusada sem gravar', async () => {
      const r = await porta.conferirComCnes(ctx(), { competencia: '202610' });
      const [rem] = await ler('SELECT numero_remessa FROM remessa_cnes WHERE id = ?', [r.id]);
      expect(rem).toMatchObject({ numero_remessa: 2 });
      await expect(porta.conferirComCnes(ctx(), { competencia: '202613' })).rejects.toMatchObject({
        problema: { status: 422 },
      });
      const [n] = await ler('SELECT COUNT(*) AS n FROM remessa_cnes WHERE estabelecimento_id = ?', [m.est]);
      expect(Number(n!['n'])).toBe(2);
    });

    it('resolve a crítica: resolvida, quando e por quem; resolver de novo é recusado', async () => {
      const [c] = await ler<{ id: number; versao: number }>(
        `SELECT cc.id, cc.versao FROM critica_cnes cc JOIN remessa_cnes r ON r.id = cc.remessa_cnes_id
        WHERE r.estabelecimento_id = ? AND cc.gravidade = 'erro' ORDER BY cc.id LIMIT 1`,
        [m.est],
      );
      await porta.resolverCriticaCnes(ctx(), Number(c!.id), { versao: Number(c!.versao) });
      const [d] = await ler(
        `SELECT resolvida, resolvida_em IS NOT NULL AS quando, resolvida_usuario_id, versao FROM critica_cnes WHERE id = ?`,
        [c!.id],
      );
      expect(Number(d!['resolvida'])).toBe(1);
      expect(Number(d!['quando'])).toBe(1);
      expect(d).toMatchObject({ resolvida_usuario_id: m.usuario, versao: Number(c!.versao) + 1 });
      await expect(
        porta.resolverCriticaCnes(ctx(), Number(c!.id), { versao: Number(c!.versao) + 1 }),
      ).rejects.toMatchObject({ problema: { status: 422 } });
    });
  },
);
