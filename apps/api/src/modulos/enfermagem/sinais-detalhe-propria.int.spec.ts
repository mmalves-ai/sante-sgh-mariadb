// Contrato de efeito dos sinais vitais com o detalhe da aferição e os limites de alerta por setor (03-PEP L115), no
// MariaDB: o padrão do NEWS2 entra no estabelecimento uma vez só; o limite do setor ganha do padrão; a regra do setor
// exige local e posição (recusa sem gravar nada); o valor fora da faixa só grava confirmado; afericao_valor guarda o
// instrumento, o local, a posição e o nivel_alerta do limite escolhido; "não aferido" guarda o motivo e o complemento,
// sem valor e sem nível; o limite inativado fica no banco (ativo = 0) e deixa de valer; trilha na mesma transação.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLimparTrilha } from '../../teste/limpar-trilha.spec-util.js';
import { fusoDe, localNoFuso } from './banco-apoio.js';
import {
  CLIENTE,
  garantir,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaEnfermagemPropria } from './porta-propria.js';
import {
  afericoesDoPaciente,
  aplicarPadraoNews2Tx,
  gravarRegraSetorTx,
  inativarLimiteTx,
  incluirLimiteTx,
  limitesDoEstabelecimento,
  type PedidoAfericao,
  type PedidoLimite,
  registrarAfericaoTx,
  TABELAS_AFERICAO_DETALHE,
  TABELAS_LIMITES,
  type ValorAfericaoPedido,
} from './sinais-detalhe-propria.js';

const MARCA = 'L0115';

describe.skipIf(SEM_BANCO)(
  'sinais vitais: detalhe da aferição e limites por setor (03-PEP L115, MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let m: MassaEnfermagem | null = null;
    let enf: PortaEnfermagemPropria;
    let setor = 0;
    const cat = { instrumento: 0, local: 0, posicao: 0, motivo: 0 };
    let hora = '';

    const ctx = (): ContextoNucleo => ({
      cliente: CLIENTE,
      estabelecimento: m!.est,
      usuario: m!.usuario,
      correlacao: `t-${MARCA}-${randomUUID().slice(0, 8)}`,
    });
    const op = () => ({ ...ctx(), chaveIdempotencia: `t-${MARCA}-${randomUUID()}` });
    const ler = <T>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-confere` }, (l) =>
        l.consultar<T & Record<string, unknown>>(sql, p),
      );
    const trilha = (entidade: string) => (f: { id?: number; afericao?: number }) => ({
      estabelecimento: null,
      usuario: null,
      correlacao: null,
      acao: 'inclusao' as const,
      entidade,
      entidadeId: f.afericao ?? f.id ?? null,
    });
    const afericoesDoPacienteNoBanco = async () =>
      Number(
        (
          await ler<{ n: number }>('SELECT COUNT(*) AS n FROM afericao WHERE paciente_id = ?', [m!.paciente])
        )[0]!.n,
      );
    const valor = (x: Partial<ValorAfericaoPedido>): ValorAfericaoPedido => ({
      tipo: 'fc',
      valor: null,
      instrumento: null,
      local: null,
      posicao: null,
      naoAferido: false,
      motivo: null,
      justificativa: null,
      confirmadoForaDaFaixa: false,
      ...x,
    });
    const aferir = (valores: ValorAfericaoPedido[], atendimento: number | null = m!.atendimento) =>
      enf.gravarNaTransacao(
        op(),
        'enfermagem.registrar-afericao-detalhada',
        TABELAS_AFERICAO_DETALHE,
        trilha('afericao'),
        (tx, est, an) =>
          registrarAfericaoTx(tx, est, an, {
            paciente: m!.paciente,
            atendimento,
            horaReal: hora,
            observacao: null,
            valores,
          } satisfies PedidoAfericao),
      );
    const incluirLimite = (p: Partial<PedidoLimite>) =>
      enf.gravarNaTransacao(
        op(),
        'enfermagem.incluir-limite-sinal',
        TABELAS_LIMITES,
        trilha('limite_parametro_vital'),
        (tx, est, an) =>
          incluirLimiteTx(tx, est, an, {
            parametro: 'fc',
            abrangencia: 'estabelecimento',
            setor: null,
            instrumento: null,
            sexo: 'ambos',
            idadeMinimaDias: 0,
            idadeMaximaDias: null,
            limiteInferior: null,
            normalInferior: null,
            normalSuperior: null,
            limiteSuperior: null,
            ...p,
          }),
      );

    async function limparMinha(): Promise<void> {
      if (!m) return;
      const ests = [m.est, m.outroEst];
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
        await e.executar(
          'DELETE v FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.paciente_id = ?',
          [m!.paciente],
        );
        await e.executar('DELETE FROM afericao WHERE paciente_id = ?', [m!.paciente]);
        await e.executar('DELETE FROM limite_parametro_vital WHERE estabelecimento_id IN (?, ?)', ests);
        await e.executar(
          'DELETE r FROM parametro_vital_setor r JOIN setor_funcional s ON s.id = r.setor_funcional_id WHERE s.estabelecimento_id IN (?, ?)',
          ests,
        );
        for (const t of ['instrumento_afericao', 'local_afericao', 'posicao_afericao', 'motivo_nao_afericao'])
          await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${MARCA}%`]);
        for (const sql of sqlLimparTrilha(ests)) await e.executar(sql);
      });
    }

    beforeAll(async () => {
      garantirCliente();
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo, MARCA, false);
      await limparMinha();
      enf = new PortaEnfermagemPropria(nucleo);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo` }, async (e) => {
        const agora = new Date();
        const pv = (codigo: string, descricao: string, min: number, max: number) =>
          garantir(
            e,
            'SELECT id FROM parametro_vital WHERE codigo = ?',
            [codigo],
            'INSERT INTO parametro_vital (codigo, descricao, alerta_minimo, alerta_maximo, criado_em) VALUES (?, ?, ?, ?, ?)',
            [codigo, descricao, min, max, agora],
          );
        const fc = await pv('fc', 'Frequência cardíaca', 50, 120);
        await pv('fr', 'Frequência respiratória', 10, 25);
        await e.executar('UPDATE parametro_vital SET ativo = TRUE WHERE codigo IN (?, ?)', ['fc', 'fr']);
        const s = await e.uma<{ setor_funcional_id: number }>(
          'SELECT setor_funcional_id FROM atendimento WHERE id = ?',
          [m!.atendimento],
        );
        setor = Number(s!.setor_funcional_id);
        cat.instrumento = await e.inserir(
          'INSERT INTO instrumento_afericao (codigo, descricao, parametro_vital_id, criado_em) VALUES (?, ?, ?, ?)',
          [`${MARCA}_OXI`, 'OXIMETRO SINTETICO', fc, agora],
        );
        cat.local = await e.inserir(
          'INSERT INTO local_afericao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [`${MARCA}_RAD`, 'RADIAL SINTETICO', agora],
        );
        cat.posicao = await e.inserir(
          'INSERT INTO posicao_afericao (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [`${MARCA}_DEI`, 'DEITADO SINTETICO', agora],
        );
        cat.motivo = await e.inserir(
          'INSERT INTO motivo_nao_afericao (codigo, descricao, exige_complemento, criado_em) VALUES (?, ?, TRUE, ?)',
          [`${MARCA}_REC`, 'RECUSA SINTETICA', agora],
        );
      });
      const fuso = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-fuso` }, (l) =>
        fusoDe(l, m!.est),
      );
      hora = localNoFuso(new Date(Date.now() - 10 * 60_000), fuso).slice(0, 16);
    }, 120_000);

    afterAll(async () => {
      await limparMinha();
      await limparMassa(nucleo, m);
      await nucleo?.encerrar();
    });

    let limiteNews2Fc = 0;
    let limiteSetor = 0;

    it('o padrão do NEWS2 entra no estabelecimento uma vez só', async () => {
      const r = await enf.gravarNaTransacao(
        op(),
        'enfermagem.aplicar-limites-news2',
        TABELAS_LIMITES,
        trilha('limite_parametro_vital')({}),
        (tx, est, an) => aplicarPadraoNews2Tx(tx, est, an),
      );
      expect(r.incluidos).toEqual(expect.arrayContaining(['fc', 'fr']));
      const de2 = await enf.gravarNaTransacao(
        op(),
        'enfermagem.aplicar-limites-news2',
        TABELAS_LIMITES,
        trilha('limite_parametro_vital')({}),
        (tx, est, an) => aplicarPadraoNews2Tx(tx, est, an),
      );
      expect(de2.incluidos).toEqual([]);
      expect(de2.jaTinha).toEqual(expect.arrayContaining(['fc', 'fr']));
      const [l] = await ler<{
        id: number;
        normal_superior: string;
        limite_superior: string;
        idade_minima_dias: number;
      }>(
        `SELECT l.id, l.normal_superior, l.limite_superior, l.idade_minima_dias FROM limite_parametro_vital l
         JOIN parametro_vital p ON p.id = l.parametro_vital_id
        WHERE p.codigo = 'fc' AND l.estabelecimento_id = ? AND l.ativo`,
        [m!.est],
      );
      expect(Number(l!.normal_superior)).toBe(90);
      expect(Number(l!.limite_superior)).toBe(130);
      expect(Number(l!.idade_minima_dias)).toBe(6575);
      limiteNews2Fc = Number(l!.id);
    });

    it('o limite fora de ordem é recusado; o do setor e a regra do setor gravam', async () => {
      await expect(incluirLimite({ normalInferior: 100, normalSuperior: 80 })).rejects.toMatchObject({
        problema: { codigo: 'normal-invertido' },
      });
      const r = await incluirLimite({ setor, normalInferior: 55, normalSuperior: 80, limiteSuperior: 100 });
      limiteSetor = r.id;
      const regra = await enf.gravarNaTransacao(
        op(),
        'enfermagem.gravar-regra-setor-sinal',
        TABELAS_LIMITES,
        trilha('parametro_vital_setor'),
        (tx, est, an) =>
          gravarRegraSetorTx(tx, est, an, {
            setor,
            parametro: 'fc',
            obrigatorio: true,
            periodicidadeMinutos: 240,
            exibeLocal: false,
            exigeLocal: true,
            exibePosicao: false,
            exigePosicao: true,
            ativo: true,
            versao: null,
          }),
      );
      const [g] = await ler<Record<string, unknown>>(
        'SELECT exibe_local_afericao, exige_local_afericao, exibe_posicao_afericao, exige_posicao_afericao, periodicidade_minutos FROM parametro_vital_setor WHERE id = ?',
        [regra.id],
      );
      expect(g).toMatchObject({
        exibe_local_afericao: 1,
        exige_local_afericao: 1,
        exibe_posicao_afericao: 1,
        exige_posicao_afericao: 1,
      });
      expect(Number(g!['periodicidade_minutos'])).toBe(240);
      const lista = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-l` }, (l) =>
        limitesDoEstabelecimento(l, m!.est),
      );
      expect(lista.find((x) => x.id === limiteSetor)).toMatchObject({
        setor,
        parametro: 'fc',
        normalSuperior: 80,
      });
    });

    it('sem local e posição exigidos pelo setor, ou sem a confirmação do valor fora da faixa, nada é gravado', async () => {
      const antes = await afericoesDoPacienteNoBanco();
      await expect(aferir([valor({ valor: 90 })])).rejects.toMatchObject({
        problema: { codigo: 'local-obrigatorio' },
      });
      await expect(aferir([valor({ valor: 90, local: cat.local })])).rejects.toMatchObject({
        problema: { codigo: 'posicao-obrigatoria' },
      });
      await expect(
        aferir([valor({ valor: 90, local: cat.local, posicao: cat.posicao, instrumento: cat.instrumento })]),
      ).rejects.toMatchObject({ problema: { codigo: 'sinal-confirmar' } });
      await expect(
        aferir([
          valor({ valor: 70, local: cat.local, posicao: cat.posicao }),
          valor({ tipo: 'fr', naoAferido: true, motivo: cat.motivo }),
        ]),
      ).rejects.toMatchObject({ problema: { codigo: 'complemento-obrigatorio' } });
      expect(await afericoesDoPacienteNoBanco()).toBe(antes);
    });

    it('grava o detalhe e o nível pelo limite do setor; o não aferido guarda o motivo, sem valor nem nível', async () => {
      const r = await aferir([
        valor({
          valor: 90,
          local: cat.local,
          posicao: cat.posicao,
          instrumento: cat.instrumento,
          confirmadoForaDaFaixa: true,
        }),
        valor({
          tipo: 'fr',
          naoAferido: true,
          motivo: cat.motivo,
          justificativa: 'Paciente recusou a contagem',
        }),
      ]);
      expect(r.setor).toBe(setor);
      expect(r.valores).toEqual([
        expect.objectContaining({ tipo: 'fc', nivel: 'atencao', limite: limiteSetor }),
        expect.objectContaining({ tipo: 'fr', nivel: null, limite: null }),
      ]);
      const vs = await ler<Record<string, unknown>>(
        `SELECT v.sequencia, v.valor_numerico, v.instrumento_afericao_id, v.local_afericao_id, v.posicao_afericao_id,
              v.nivel_alerta, v.nao_aferido, v.motivo_nao_afericao_id, v.justificativa_nao_afericao,
              a.setor_funcional_id, a.profissional_id, a.estabelecimento_id
         FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.id = ? ORDER BY v.sequencia`,
        [r.afericao],
      );
      expect(vs).toHaveLength(2);
      expect(Number(vs[0]!['valor_numerico'])).toBe(90);
      expect(vs[0]).toMatchObject({
        instrumento_afericao_id: cat.instrumento,
        local_afericao_id: cat.local,
        posicao_afericao_id: cat.posicao,
        nivel_alerta: 'atencao',
        nao_aferido: 0,
        setor_funcional_id: setor,
        profissional_id: m!.profissional,
        estabelecimento_id: m!.est,
      });
      expect(vs[1]).toMatchObject({
        valor_numerico: null,
        nivel_alerta: null,
        nao_aferido: 1,
        motivo_nao_afericao_id: cat.motivo,
        justificativa_nao_afericao: 'Paciente recusou a contagem',
      });
      const t = await ler<{ n: number }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'afericao' AND entidade_id = ?",
        [String(r.afericao)],
      );
      expect(Number(t[0]!.n)).toBe(1);
      const lidos = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-p` }, (l) =>
        afericoesDoPaciente(l, m!.est, m!.paciente),
      );
      expect(lidos.find((x) => x.tipo === 'fc')).toMatchObject({
        instrumento: 'OXIMETRO SINTETICO',
        local: 'RADIAL SINTETICO',
        posicao: 'DEITADO SINTETICO',
        nivel: 'atencao',
      });
      expect(lidos.find((x) => x.tipo === 'fr')).toMatchObject({
        naoAferido: true,
        motivo: 'RECUSA SINTETICA',
      });
    });

    it('acima do crítico do setor é crítico; fora do setor vale o padrão do NEWS2 do estabelecimento', async () => {
      const r = await aferir([
        valor({ valor: 105, local: cat.local, posicao: cat.posicao, confirmadoForaDaFaixa: true }),
      ]);
      expect(r.valores[0]).toMatchObject({ nivel: 'critico', limite: limiteSetor });
      const sem = await aferir([valor({ valor: 95, confirmadoForaDaFaixa: true })], null);
      expect(sem.setor).toBeNull();
      expect(sem.valores[0]).toMatchObject({ nivel: 'atencao', limite: limiteNews2Fc });
    });

    it('o limite inativado fica no banco e deixa de valer', async () => {
      const [l] = await ler<{ versao: number }>('SELECT versao FROM limite_parametro_vital WHERE id = ?', [
        limiteSetor,
      ]);
      const inativar = (versao: number) =>
        enf.gravarNaTransacao(
          op(),
          'enfermagem.inativar-limite-sinal',
          TABELAS_LIMITES,
          trilha('limite_parametro_vital'),
          (tx, est, an) =>
            inativarLimiteTx(tx, est, an, limiteSetor, versao, 'Revisão dos limites da unidade'),
        );
      await inativar(Number(l!.versao));
      await expect(inativar(Number(l!.versao) + 1)).rejects.toMatchObject({
        problema: { codigo: 'limite-ja-inativo' },
      });
      const [g] = await ler<{ ativo: number; versao: number }>(
        'SELECT ativo, versao FROM limite_parametro_vital WHERE id = ?',
        [limiteSetor],
      );
      expect(Number(g!.ativo)).toBe(0);
      expect(Number(g!.versao)).toBe(Number(l!.versao) + 1);
      const r = await aferir([valor({ valor: 90, local: cat.local, posicao: cat.posicao })]);
      expect(r.valores[0]).toMatchObject({ nivel: 'normal', limite: limiteNews2Fc });
    });
  },
);
