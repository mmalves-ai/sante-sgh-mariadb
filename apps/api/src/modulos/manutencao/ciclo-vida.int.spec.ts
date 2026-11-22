// Ciclo de vida e treinamento dos operadores (M55, RDC 509/2021) sobre a porta própria no MariaDB (cliente de teste do lote):
// o catálogo de cursos e as conclusões vêm do treinamento (curso, turma, presença); a base do índice de obsolescência
// vem das OS do equipamento e entra no `montarIndice` real; o curso exigido por modelo (modelo_equipamento_curso) e os
// eventos do ciclo de vida (evento_ciclo_equipamento) são gravados e relidos do banco. Massa SINTÉTICA. SGH_NUCLEO_SEM_BANCO=1 pula.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conferirEvento, inicioDaJanela, montarIndice } from './ciclo-vida.js';
import {
  CLIENTE_MAN,
  contextoMan,
  encerrarMassaManutencao,
  lerBanco,
  type MassaManutencao,
  prepararMassaManutencao,
  SEM_BANCO_MAN,
  trilhaMan,
} from './massa.spec-util.js';
import { PortaManutencaoPropria } from './porta-propria.js';

const codigoDe = (e: unknown) => (e as { problema?: { codigo?: string } }).problema?.codigo;

describe.skipIf(SEM_BANCO_MAN)(
  `ciclo de vida e treinamento na porta própria (cliente ${CLIENTE_MAN})`,
  () => {
    let m: MassaManutencao | null = null;
    let porta: PortaManutencaoPropria;
    beforeAll(async () => {
      m = await prepararMassaManutencao('C');
      porta = new PortaManutencaoPropria(m.nucleo);
    }, 120_000);
    afterAll(async () => {
      await encerrarMassaManutencao(m);
    });

    it('catálogo do treinamento e conclusões (sem turma concluída: nenhuma)', async () => {
      const M = m!;
      const cat = await porta.catalogoCursos(contextoMan(M));
      expect(cat.find((x) => x.id === M.curso)).toEqual({
        id: M.curso,
        codigo: 'L0303M-OPER',
        titulo: 'OPERACAO SINTETICA DO MONITOR',
        validadeMeses: 24,
        ativo: true,
      });
      expect(await porta.conclusoesDosCursos(contextoMan(M), [M.curso])).toEqual([]);
      expect(await porta.conclusoesDosCursos(contextoMan(M), [])).toEqual([]);
    });

    it('índice de obsolescência: a base (custo e corretivas) das OS do equipamento na janela', async () => {
      const M = m!;
      const c = contextoMan(M);
      const { hoje, agora } = await porta.relogio(c);
      const eq = await porta.gravarSgh(c, trilhaMan(M, 'ordem_servico_manutencao'), async (g) => {
        const e = await g.incluirEquipamento({
          codigo: 'L0303-CICLO',
          nome: 'BOMBA SINTETICA',
          tipo: 'medico',
          criticidade: 'alta',
          classeRisco: 'II',
          fabricante: null,
          modelo: null,
          numeroSerie: null,
          registroAnvisa: null,
          unidade: null,
          centroCusto: M.centro,
          localizacao: null,
          recurso: null,
          bemPatrimonial: null,
          instalacao: '2018-03-01',
          garantiaAte: null,
          situacao: 'ativo',
          motivo: null,
          usuario: M.loginUsuario,
        });
        for (const pecas of [10_000, 30_000]) {
          const os = await g.abrirOs({
            natureza: 'corretiva',
            equipamento: e.id,
            centroCusto: M.centro,
            local: null,
            descricao: 'Falha (teste)',
            contato: null,
            prioridadeSugerida: 'media',
            prioridade: 'media',
            solicitante: M.loginUsuario,
            registro: agora,
            parado: false,
            plano: null,
            nota: null,
          });
          await g.mudarOs({
            id: os.id,
            versaoVista: 1,
            de: 'aberta',
            para: 'emAtendimento',
            campos: { custoPecasCent: pecas },
            usuario: M.loginUsuario,
            nota: null,
          });
        }
        return e;
      });
      const base = await porta.baseObsolescencia(c, eq.id, inicioDaJanela(hoje));
      expect(base).toEqual({ custoCent: 40_000, corretivas: 2 });
      const indice = montarIndice({
        hoje,
        eventos: await porta.eventosCiclo(c, eq.id),
        instalacao: '2018-03-01',
        bem: null,
        vidaUtilPadraoMeses: 120,
        base,
      });
      expect(indice).toBeTruthy();
    });

    it('curso exigido por modelo: vincular, repetido, desvincular com motivo e reativar', async () => {
      const M = m!;
      const c = contextoMan(M);
      const chave = { fabricante: 'L0303M FAB CURSO', modelo: 'MX-2' };
      const v = await porta.gravarSgh(c, trilhaMan(M, 'modelo_equipamento_curso'), (g) =>
        g.vincularCursoModelo({ ...chave, curso: M.curso, usuario: M.loginUsuario }),
      );
      expect(await porta.cursosDosModelos(c, chave)).toMatchObject([
        {
          id: v.id,
          fabricante: chave.fabricante,
          modelo: 'MX-2',
          curso: M.curso,
          cursoCodigo: 'L0303M-OPER',
          cursoAtivo: true,
          validadeMeses: 24,
          criadoPor: M.loginUsuario,
        },
      ]);
      await expect(
        porta.gravarSgh(c, trilhaMan(M, 'modelo_equipamento_curso'), (g) =>
          g.vincularCursoModelo({ ...chave, curso: M.curso, usuario: M.loginUsuario }),
        ),
      ).rejects.toSatisfy((e) => codigoDe(e) === 'vinculo-repetido');
      await porta.gravarSgh(c, trilhaMan(M, 'modelo_equipamento_curso', v.id), (g) =>
        g.desvincularCursoModelo({ id: v.id, motivo: 'Curso trocado (teste)', usuario: M.loginUsuario }),
      );
      expect(await porta.cursosDosModelos(c, chave)).toEqual([]);
      const de = await porta.gravarSgh(c, trilhaMan(M, 'modelo_equipamento_curso'), (g) =>
        g.vincularCursoModelo({ ...chave, curso: M.curso, usuario: M.loginUsuario }),
      );
      expect(de.id).toBe(v.id);
    });

    it('ciclo de vida: desativação grava o evento e a data no equipamento; evento repetido recusa sem resíduo', async () => {
      const M = m!;
      const c = contextoMan(M);
      const eq = await porta.gravarSgh(c, trilhaMan(M, 'equipamento_saude'), (g) =>
        g.incluirEquipamento({
          codigo: 'L0303-CICLO2',
          nome: 'BOMBA SINTETICA 2',
          tipo: 'medico',
          criticidade: 'alta',
          classeRisco: 'II',
          fabricante: null,
          modelo: null,
          numeroSerie: null,
          registroAnvisa: null,
          unidade: null,
          centroCusto: M.centro,
          localizacao: null,
          recurso: null,
          bemPatrimonial: null,
          instalacao: '2018-03-01',
          garantiaAte: null,
          situacao: 'ativo',
          motivo: null,
          usuario: M.loginUsuario,
        }),
      );
      const novo = { tipo: 'desativacao' as const, data: '2026-01-02' };
      const r = await porta.gravarSgh(c, trilhaMan(M, 'evento_ciclo_equipamento'), (g) =>
        g.registrarEventoCiclo({
          equipamento: eq.id,
          ...novo,
          motivo: 'Fim da vida útil (teste)',
          documento: null,
          destino: null,
          valorObtidoCent: null,
          autorizadoPor: 'TESTE',
          usuario: M.loginUsuario,
          conferir: conferirEvento(novo),
        }),
      );
      expect(r.valorContabilCent).toBeNull();
      expect(await porta.eventosCiclo(c, eq.id)).toMatchObject([
        {
          id: r.id,
          equipamento: eq.id,
          tipo: 'desativacao',
          data: '2026-01-02',
          autorizadoPor: 'TESTE',
          por: M.loginUsuario,
        },
      ]);
      expect(await porta.equipamento(c, eq.id)).toMatchObject({
        situacao: 'desativado',
        desativadoEm: '2026-01-02',
      });
      await expect(
        porta.gravarSgh(c, trilhaMan(M, 'evento_ciclo_equipamento'), (g) =>
          g.registrarEventoCiclo({
            equipamento: eq.id,
            ...novo,
            motivo: 'de novo (teste)',
            documento: null,
            destino: null,
            valorObtidoCent: null,
            autorizadoPor: 'TESTE',
            usuario: M.loginUsuario,
            conferir: () => null,
          }),
        ),
      ).rejects.toSatisfy((e) => codigoDe(e) === 'evento-repetido');
      expect(
        await lerBanco(
          M,
          'SELECT COUNT(*) AS n FROM evento_ciclo_equipamento WHERE equipamento_saude_id = ?',
          [eq.id],
        ),
      ).toMatchObject({ n: 1 });
    });
  },
);
