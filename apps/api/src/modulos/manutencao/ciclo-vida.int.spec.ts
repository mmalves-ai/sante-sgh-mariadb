// W0-08, parte 9 (mercado M3): o treinamento dos operadores por modelo e o ciclo de vida do equipamento
// (SGH_MAN_MODELO_CURSO e SGH_MAN_EQUIP_EVENTO, script 1107) na cópia de dev, numa transação SEMPRE desfeita, com dados
// SINTÉTICOS (setor fora de qualquer real; fabricante, cursos e vínculos inventados): o curso inativo recusado, o par repetido recusado; os aptos pela
// conclusão dos dois cursos exigidos (o de um curso só fica pendente); a base do índice pelas OS corretivas e seus
// custos; os eventos na ordem (descarte sem desativação recusado; a desativação marca o equipamento desativado; o
// descarte com documento e destino; depois nada mais); o desvínculo com o retrato. Só tabelas SGH_.
import {
  conferirEventoCiclo,
  indiceObsolescencia,
  normalizarModelo,
  operadoresDoModelo,
} from '@sgh/dominio-manutencao';
import {
  abrirOsSgh,
  desvincularCursoModeloSgh,
  ErroOperacao,
  type Escritor,
  escritasDaTransacao,
  type EventoCicloParaGravar,
  incluirCursoPesSgh,
  incluirEquipamentoSgh,
  incluirTurmaPesSgh,
  type Leitor,
  lerBaseObsolescencia,
  lerConclusoesDosCursos,
  lerCursoDoModelo,
  lerCursosDosModelos,
  lerEquipamento,
  lerEventosCiclo,
  registrarEventoCicloSgh,
  relogioManutencao,
  somenteSgh,
  vincularCursoModeloSgh,
} from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../acesso/aplicacao/copia.spec-util.js';

const USUARIO = 'SGH.TESTE.W008';
const SETOR = 2_000_110_602;
const FABRICANTE = 'Fabricante Sintético W008 Ciclo';

async function codigoDe(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (x) {
    if (x instanceof ErroOperacao) return x.problema.codigo ?? 'sem-codigo';
    return String(x);
  }
}

const retrato = async (l: Leitor) => {
  const r: Record<string, string> = {};
  for (const t of [
    'SGH_MAN_MODELO_CURSO',
    'SGH_MAN_EQUIP_EVENTO',
    'SGH_MAN_EQUIPAMENTO',
    'SGH_MAN_OS',
    'SGH_PES_CURSO',
    'SGH_PES_TREINAMENTO',
    'SGH_PES_TREIN_PARTICIPANTE',
    'SGH_PES_VINCULO',
    'SGH_HIST_EXCLUSAO',
  ]) {
    const [x] = await l.consultar(`SELECT COUNT(*) N, MAX(ID) M FROM ${t}`, [], { teto: 1 });
    r[t] = `${String(x?.['N'])}/${String(x?.['M'])}`;
  }
  return JSON.stringify(r);
};

describe.skipIf(!PODE_ESCREVER)(
  'treinamento por modelo e ciclo de vida na cópia (transação desfeita)',
  () => {
    let a: AmbienteM27;
    beforeAll(async () => {
      a = await ambienteM27();
    }, 900_000);
    afterAll(async () => {
      await a?.nucleo.encerrar();
    });

    it('cursos do modelo, aptos, base do índice, eventos em ordem e desvínculo com retrato; ROLLBACK', async () => {
      const ctx = { ...a.c, traceId: 'int-w008-ciclo' };
      const antes = await a.nucleo.lerSomente(ctx, retrato);
      const r = await a.nucleo.desfazendoNaCopia(ctx, async (e0) => {
        const e: Escritor = somenteSgh(e0);
        const { hoje, agora } = await relogioManutencao(e);
        const curso = (codigo: string) =>
          incluirCursoPesSgh(e, {
            codigo,
            titulo: `Operação da bomba sintética ${codigo}`,
            conteudo: 'Conteúdo sintético do teste do W0-08.',
            categoria: 'outro',
            cargaMinimaMin: 60,
            validadeMeses: 12,
            obrigatorio: false,
            alvos: [],
            hospital: e.hospital,
            por: USUARIO,
          });
        const c1 = await curso('W008C1');
        const c2 = await curso('W008C2');
        const c3 = await curso('W008C3');
        await e.executar(`UPDATE SGH_PES_CURSO SET ATIVO = 'F' WHERE ID = ?`, [c3]);

        const chave = { fabricante: normalizarModelo(FABRICANTE), modelo: normalizarModelo('bi-900') };
        const v1 = await vincularCursoModeloSgh(e, { ...chave, curso: c1, usuario: USUARIO });
        const v2 = await vincularCursoModeloSgh(e, { ...chave, curso: c2, usuario: USUARIO });
        const repetido = await codigoDe(vincularCursoModeloSgh(e, { ...chave, curso: c1, usuario: USUARIO }));
        const inativo = await codigoDe(vincularCursoModeloSgh(e, { ...chave, curso: c3, usuario: USUARIO }));

        // Dois vínculos SINTÉTICOS (a cópia pode não ter nenhum): o primeiro conclui os dois cursos, o segundo só o primeiro.
        const vinculo = async (n: number) => {
          const [x] = await e.consultar(
            'SELECT CAST(NEXT VALUE FOR SGH_GEN_PES_VINCULO AS VARCHAR(20)) ID FROM RDB$DATABASE',
            [],
            { teto: 1 },
          );
          const id = Number(x?.['ID']);
          await e.executar(
            `INSERT INTO SGH_PES_VINCULO (ID, HOSPITAL, PESSOA, CPF_HMAC, CPF_CIFRADO, NOME, TIPO, CARGO, CARGA_SEMANAL,
             ID_TBCENCUS, ADMISSAO, CRIADO_POR, ALTERADO_POR)
           VALUES (?, ?, ?, ?, 'sintetico', ?, 'clt', 'OPERADOR SINTETICO', 40, ?, '2020-01-01', ?, ?)`,
            [
              id,
              e.hospital,
              -id,
              String(n).repeat(64).slice(0, 64),
              `OPERADOR SINTETICO W008 ${n}`,
              SETOR,
              USUARIO,
              USUARIO,
            ],
          );
          return id;
        };
        const p1 = await vinculo(1);
        const p2 = await vinculo(2);
        const turma = (c: number) =>
          incluirTurmaPesSgh(e, {
            hospital: e.hospital,
            curso: c,
            inicio: hoje,
            fim: hoje,
            cargaMin: 60,
            instrutor: 'INSTRUTOR SINTETICO',
            modalidade: 'presencial',
            local: null,
            pop: null,
            observacao: null,
            por: USUARIO,
          });
        const t1 = await turma(c1);
        const t2 = await turma(c2);
        const concluir = (t: number, v: number) =>
          e.executar(
            `INSERT INTO SGH_PES_TREIN_PARTICIPANTE (ID, HOSPITAL, ID_TREINAMENTO, ID_VINCULO, PRESENCA, APROVEITAMENTO,
             CONCLUSAO, VALIDO_ATE, CRIADO_POR, ALTERADO_POR)
           VALUES (NEXT VALUE FOR SGH_GEN_PES_TREIN_PARTICIPANTE, ?, ?, ?, 'presente', 'aprovado', CURRENT_DATE,
             DATEADD(12 MONTH TO CURRENT_DATE), ?, ?)`,
            [e.hospital, t, v, USUARIO, USUARIO],
          );
        await concluir(t1, p1);
        await concluir(t2, p1);
        await concluir(t1, p2);
        const cursos = await lerCursosDosModelos(e, e.hospital, chave);
        const conclusoes = (
          await lerConclusoesDosCursos(
            e,
            e.hospital,
            cursos.map((c) => c.curso),
          )
        ).filter((c) => c.vinculo === p1 || c.vinculo === p2);
        const operadores = operadoresDoModelo(cursos, conclusoes, hoje);

        // Base do índice: duas corretivas com custo e uma preventiva.
        const eq = await incluirEquipamentoSgh(e, {
          codigo: 'W008-CV-1',
          nome: 'BOMBA SINTETICA CICLO',
          tipo: 'medico',
          criticidade: 'alta',
          classeRisco: 'III',
          fabricante: FABRICANTE,
          modelo: 'BI-900',
          numeroSerie: 'SN-CV-1',
          registroAnvisa: null,
          unidade: null,
          centroCusto: SETOR,
          localizacao: null,
          recurso: null,
          bemPatrimonial: null,
          instalacao: '2018-01-10',
          garantiaAte: null,
          situacao: 'ativo',
          motivo: null,
          usuario: USUARIO,
        });
        const os = (natureza: 'corretiva' | 'preventiva') =>
          abrirOsSgh(e, {
            natureza,
            equipamento: eq.id,
            centroCusto: SETOR,
            local: null,
            descricao: 'OS sintética do teste do índice',
            contato: null,
            prioridadeSugerida: 'media',
            prioridade: 'media',
            solicitante: USUARIO,
            registro: agora.slice(0, 16),
            parado: false,
            plano: null,
            nota: null,
          });
        const o1 = await os('corretiva');
        await os('corretiva');
        const o3 = await os('preventiva');
        await e.executar(
          `UPDATE SGH_MAN_OS SET CUSTO_PECAS_CENT = 120000, CUSTO_TERCEIROS_CENT = 30000 WHERE ID = ?`,
          [o1.id],
        );
        await e.executar(`UPDATE SGH_MAN_OS SET CUSTO_MAO_OBRA_CENT = 50000 WHERE ID = ?`, [o3.id]);
        const base = await lerBaseObsolescencia(e, e.hospital, eq.id, '2000-01-01');
        const indice = indiceObsolescencia({ idadeMeses: 100, vidaUtilMeses: 120, ...base, valorCent: null });

        // Eventos do ciclo de vida.
        const evento = (x: Partial<EventoCicloParaGravar> & Pick<EventoCicloParaGravar, 'tipo' | 'data'>) =>
          registrarEventoCicloSgh(e, {
            equipamento: eq.id,
            motivo: 'Evento sintético do teste do ciclo de vida',
            documento: null,
            destino: null,
            valorObtidoCent: null,
            autorizadoPor: 'RESPONSAVEL SINTETICO',
            usuario: USUARIO,
            conferir: (existentes, h) => conferirEventoCiclo(existentes, { tipo: x.tipo, data: x.data }, h),
            ...x,
          });
        const inc = await evento({ tipo: 'incorporacao', data: '2018-01-10' });
        const incDeNovo = await codigoDe(evento({ tipo: 'incorporacao', data: '2018-01-10' }));
        const descSemDes = await codigoDe(
          evento({ tipo: 'descarte', data: hoje, documento: 'CERT-1', destino: 'residuo' }),
        );
        const descIncompleto = await codigoDe(evento({ tipo: 'descarte', data: hoje }));
        const des = await evento({
          tipo: 'desativacao',
          data: hoje,
          motivo: 'Fim da vida útil (teste sintético)',
        });
        const equipDesativado = await lerEquipamento(e, e.hospital, eq.id);
        const desc = await evento({
          tipo: 'descarte',
          data: hoje,
          documento: 'CERT-DEST-W008',
          destino: 'residuo',
          valorObtidoCent: 0,
        });
        const depoisDoDescarte = await codigoDe(evento({ tipo: 'desativacao', data: hoje }));
        const eventos = await lerEventosCiclo(e, e.hospital, eq.id);

        // Desvínculo com retrato.
        await desvincularCursoModeloSgh(e, {
          id: v2.id,
          motivo: 'Curso trocado no teste sintético',
          usuario: USUARIO,
        });
        const v2Depois = await lerCursoDoModelo(e, e.hospital, v2.id);
        const desvDeNovo = await codigoDe(
          desvincularCursoModeloSgh(e, {
            id: v2.id,
            motivo: 'Curso trocado no teste sintético',
            usuario: USUARIO,
          }),
        );
        const retratos = await e.consultar(
          `SELECT TABELA FROM SGH_HIST_EXCLUSAO WHERE HOSPITAL = ? AND OPERACAO = 'manutencao.cursoModelo.excluido'
          AND MOTIVO = ?`,
          [e.hospital, 'Curso trocado no teste sintético'],
        );
        const escritas = await escritasDaTransacao(e0);
        return {
          c: { c1, c2 },
          p: { p1, p2 },
          v1,
          cursos: cursos.map((c) => [c.curso, c.cursoAtivo, c.fabricante, c.modelo]),
          repetido,
          inativo,
          operadores,
          base,
          indice,
          inc,
          incDeNovo,
          descSemDes,
          descIncompleto,
          des,
          equipDesativado,
          desc,
          depoisDoDescarte,
          eventos: eventos.map((x) => [
            x.tipo,
            x.destino,
            x.documento,
            x.valorContabilCent,
            x.valorObtidoCent,
          ]),
          v2Depois,
          desvDeNovo,
          retratos: retratos.map((x) => String(x['TABELA']).trim()),
          escritas,
        };
      });
      const depois = await a.nucleo.lerSomente(ctx, retrato);
      const { c1, c2 } = r.c;
      const { p1, p2 } = r.p;
      expect(r.v1.id).toBeGreaterThan(0);
      expect(r.cursos).toEqual([
        [c1, true, 'FABRICANTE SINTETICO W008 CICLO', 'BI-900'],
        [c2, true, 'FABRICANTE SINTETICO W008 CICLO', 'BI-900'],
      ]);
      expect(r.repetido).toBe('vinculo-repetido');
      expect(r.inativo).toBe('curso-inativo');
      expect(r.operadores.aptos.map((x) => x.vinculo)).toEqual([p1]);
      expect(r.operadores.pendentes.map((x) => [x.vinculo, x.faltam])).toEqual([[p2, [c2]]]);
      expect(r.base).toEqual({ custoCent: 200_000, corretivas: 2 });
      // idade 100/120 → 33; custo sem bem → 0; falhas 2/6 → 10; índice 43 (acompanhar).
      expect([r.indice.idade.pontos, r.indice.custo.pontos, r.indice.falhas.pontos, r.indice.indice]).toEqual(
        [33, 0, 10, 43],
      );
      expect(r.inc.valorContabilCent).toBeNull();
      expect(r.incDeNovo).toBe('evento-repetido');
      expect(r.descSemDes).toBe('sem-desativacao');
      expect(r.descIncompleto).toBe('descarte-incompleto');
      expect(r.des.id).toBeGreaterThan(0);
      expect(r.equipDesativado?.situacao).toBe('desativado');
      expect(r.desc.id).toBeGreaterThan(0);
      expect(r.depoisDoDescarte).toBe('equipamento-descartado');
      expect(r.eventos).toEqual([
        ['incorporacao', null, null, null, null],
        ['desativacao', null, null, null, null],
        ['descarte', 'residuo', 'CERT-DEST-W008', null, 0],
      ]);
      expect(r.v2Depois).toBeNull();
      expect(r.desvDeNovo).toBe('desatualizado');
      expect(r.retratos).toEqual(['SGH_MAN_MODELO_CURSO']);
      for (const x of r.escritas) expect(x.tabela).toMatch(/^SGH_/);
      expect(depois).toBe(antes);
    }, 900_000);
  },
);
