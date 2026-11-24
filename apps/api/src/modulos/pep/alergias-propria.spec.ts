// Unidade das alergias no banco próprio (dublê do Leitor): o cliente vem da configuração, o estabelecimento da sessão
// recorta a lista e a versão dos documentos, o SQL é parametrizado, a forma segue a porta de memória (especificação)
// e — segurança do paciente — a alergia de descrição livre e a sem registro clínico aparecem na leitura e alertam na
// prescrição.
import { achados, type ContextoAlertas, type ItemAvaliado } from '@sgh/dominio-pep';
import type { Leitor, Linha } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import {
  AGENTE_NAO_INFORMADO,
  alergias,
  alergiasDaPrescricao,
  catalogoAlergias,
  registrosParaAlergia,
  versaoAlergias,
} from './alergias-propria.js';
import { PortaDocumentosMemoria } from './documentos-porta-memoria.js';
import type { NucleoLeituraPep } from './registro-porta-propria.js';

interface Chamada {
  readonly sql: string;
  readonly parametros: readonly unknown[];
}

function duble(respostas: (sql: string) => Linha[]) {
  const chamadas: Chamada[] = [];
  const contextos: { cliente: string; correlacao: string }[] = [];
  const leitor: Leitor = {
    cliente: 'x',
    async consultar<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return respostas(sql) as T[];
    },
    async uma<T extends Linha = Linha>(sql: string, parametros: readonly unknown[] = []) {
      chamadas.push({ sql, parametros });
      return (respostas(sql)[0] as T | undefined) ?? null;
    },
  };
  const nucleo: NucleoLeituraPep = {
    lerSomente: async (contexto, fn) => {
      contextos.push({ ...contexto });
      return fn(leitor);
    },
  };
  return { nucleo, chamadas, contextos };
}

const C = { rede: 'r', hospital: 'h1', cliente: '', estabelecimento: 7, usuario: null, correlacao: 't' };
const EST = { id: 7, fuso_horario: 'America/Sao_Paulo' };

const linhaAlergia = (o: Record<string, unknown>) => ({
  id: 1,
  estabelecimento_id: 7,
  alergeno_id: 2,
  descricao_livre: null,
  agente_nome: 'PENICILINA',
  natureza: 'medicamento',
  tipo_alergia: null,
  tipo_registro: 'alergia',
  observacao: null,
  reacao: null,
  gravidade: null,
  certeza: null,
  fonte_informacao: null,
  ativa: 1,
  registro_assistencial_id: 10,
  registrado_em: new Date('2026-11-21T15:00:00Z'),
  inativado_em: null,
  motivo_inativacao: null,
  profissional: 'PROF',
  ...o,
});

/** Banco dublê: alérgeno de catálogo (id 1), texto livre sem registro (id 2), texto livre inativada (id 3). */
function bancoAlergias() {
  return duble((sql) => {
    if (sql.includes('FROM estabelecimento')) return [EST];
    if (sql.includes('UNION ALL'))
      return [
        { alergia: 1, id: 500, nome: 'BENZILPENICILINA' },
        { alergia: 1, id: 500, nome: 'BENZILPENICILINA' },
        { alergia: 2, id: 600, nome: 'DIPIRONA' },
        { alergia: 3, id: null, nome: 'PRINCIPIO SO DO CLIENTE' },
      ];
    if (sql.includes('SELECT ap.id FROM alergia_paciente')) return [{ id: 1 }, { id: 2 }];
    if (sql.includes('COALESCE(ag.descricao, ap.descricao_livre)'))
      return [
        { id: 1, nome: 'PENICILINA' },
        { id: 2, nome: 'Dipirona' },
      ];
    if (sql.includes('FROM alergia_paciente ap'))
      return [
        linhaAlergia({}),
        linhaAlergia({
          id: 2,
          alergeno_id: null,
          descricao_livre: 'Dipirona',
          agente_nome: null,
          natureza: null,
          registro_assistencial_id: null,
          profissional: null,
        }),
        linhaAlergia({
          id: 3,
          alergeno_id: null,
          descricao_livre: 'Frutos do mar',
          agente_nome: null,
          natureza: null,
          ativa: 0,
          tipo_registro: 'intolerancia',
          inativado_em: new Date('2026-11-22T15:00:00Z'),
          motivo_inativacao: 'refutada',
        }),
      ];
    return [];
  });
}

describe('alergias no banco próprio (dublê)', () => {
  it('lista toda alergia do paciente no cliente inteiro, inclusive a de texto livre e a sem registro clínico', async () => {
    const { nucleo, chamadas, contextos } = bancoAlergias();
    const r = await alergias(nucleo, 'cli', C, 20);
    expect(contextos[0]).toEqual({ cliente: 'cli', correlacao: 'pep.alergias.lista' });
    const sql = chamadas.find((x) => x.sql.includes('FROM alergia_paciente ap') && !x.sql.includes('UNION'))!;
    expect(sql.parametros).toEqual([20]);
    // O paciente é do cliente inteiro: sem recorte por estabelecimento (a alergia do hospital vizinho nunca some).
    expect(sql.sql).not.toContain('ap.estabelecimento_id = ?');
    expect(sql.sql).toContain("ap.tipo_registro IN ('alergia','intolerancia')");
    expect(sql.sql).toContain("ap.situacao_registro = 'confirmado'");
    expect(sql.sql).toContain('ap.excluido_em IS NULL');
    expect(r.map((a) => a.id)).toEqual([1, 2, 3]);
    expect(r[0]).toMatchObject({
      agenteId: 2,
      agente: 'PENICILINA',
      tipo: 'Medicamento',
      ativa: true,
      registro: 10,
      registradaEm: '2026-11-21T12:00:00',
      principios: ['BENZILPENICILINA'],
      estabelecimentoId: 7,
    });
    expect(r[1]).toMatchObject({
      agenteId: null,
      agente: 'Dipirona',
      descricaoLivre: 'Dipirona',
      tipo: null,
      registro: null,
      ativa: true,
    });
    expect(r[2]).toMatchObject({
      agente: 'Frutos do mar',
      ativa: false,
      tipoRegistro: 'intolerancia',
      motivoInativacao: 'refutada',
      principios: ['PRINCIPIO SO DO CLIENTE'],
    });
    // A leitura dos documentos não infere princípio pelo nome livre (só a prescrição, para o alerta).
    const u = chamadas.find((x) => x.sql.includes('UNION ALL'))!;
    expect(u.sql).not.toContain('TRIM(ap.descricao_livre)');
  });

  it('sem nenhum nome, a linha aparece com o agente "não informado" (nunca some)', async () => {
    const { nucleo } = duble((sql) =>
      sql.includes('FROM estabelecimento')
        ? [EST]
        : sql.includes('UNION')
          ? []
          : [linhaAlergia({ alergeno_id: null, agente_nome: null, descricao_livre: '  ' })],
    );
    const [a] = await alergias(nucleo, 'cli', C, 20);
    expect(a!.agente).toBe(AGENTE_NAO_INFORMADO);
  });

  it('versão: ids ativos do paciente no cliente inteiro em ordem, como a memória', async () => {
    const { nucleo, chamadas } = bancoAlergias();
    expect(await versaoAlergias(nucleo, 'cli', C, 20)).toBe('1,2');
    const sql = chamadas.at(-1)!;
    expect(sql.parametros).toEqual([20]);
    expect(sql.sql).not.toContain('estabelecimento_id');
    expect(sql.sql).toContain('ap.ativa = TRUE');
  });

  it('versão bate com a da porta de memória para a mesma lista', async () => {
    const mem = new PortaDocumentosMemoria();
    const cm = { ...C, hospital: 'HSP' };
    const lista = await mem.alergias(cm, 1001);
    const esperado = lista
      .filter((a) => a.ativa)
      .map((a) => a.id)
      .join(',');
    expect(await mem.versaoAlergias(cm, 1001)).toBe(esperado);
  });

  it('prescrição: alergias ativas de todo o cliente com os ids oficiais; texto livre alerta pelo nome do princípio', async () => {
    const { nucleo, chamadas, contextos } = bancoAlergias();
    const r = await alergiasDaPrescricao(nucleo, 'cli', C, 20);
    expect(contextos[0]!.correlacao).toBe('pep.alergias.prescricao');
    const sql = chamadas.find((x) => x.sql.includes('COALESCE(ag.descricao, ap.descricao_livre)'))!;
    expect(sql.parametros).toEqual([20]);
    expect(sql.sql).not.toContain('estabelecimento_id');
    expect(r).toEqual([
      { alergia: 1, nome: 'PENICILINA', principios: [500] },
      { alergia: 2, nome: 'Dipirona', principios: [600] },
    ]);
    const u = chamadas.find((x) => x.sql.includes('UNION ALL'))!;
    expect(u.sql).toContain('pa.descricao COLLATE utf8mb4_uca1400_ai_ci = TRIM(ap.descricao_livre)');
    expect(u.sql).toContain('pac.nome COLLATE utf8mb4_uca1400_ai_ci = TRIM(ap.descricao_livre)');

    // O motor da prescrição alerta a alergia de texto livre no item com o princípio.
    const item: ItemAvaliado = {
      chave: 'i1',
      tipo: 'medicamento',
      produtos: [
        {
          produto: {
            produto: 77,
            nome: 'DIPIRONA 500 MG',
            principiosAtivos: [600],
            padronizado: true,
            altoAlerta: false,
            controlado: null,
            antimicrobiano: false,
            doseMinima: null,
            doseMaxima: null,
            viasPermitidas: [],
          },
          dose: 1,
          unidade: 'CP',
        },
      ],
      via: null,
      dosesNoPeriodo: 1,
      intervaloHoras: null,
      aCriterio: false,
      seNecessario: null,
      fichaAntimicrobiano: false,
    };
    const ctx: ContextoAlertas = {
      alergias: r,
      ativos: [],
      paciente: { clearance: null, pesoKg: null },
      tipoAtendimento: 'I',
      alta: false,
      regras: [],
      interacoes: [],
      duplicidade: { porMedicamento: false, porPrincipio: false, consistir: false },
      altaVigilancia: new Set(),
      dietaDeOutro: null,
      hoje: '2026-11-23',
    };
    const al = achados({ itens: [item], ctx, foraDaCategoria: [], dietas: [], decisoes: new Map() }).filter(
      (a) => a.tipo === 'alergia',
    );
    expect(al.map((a) => a.id)).toEqual(['alergia:77:2']);
    expect(al[0]!.titulo).toBe('Alergia registrada: Dipirona');
  });

  it('catálogo: alérgenos ativos com o tipo e princípios oficiais vigentes', async () => {
    const { nucleo, chamadas } = duble((sql) => {
      if (sql.includes('FROM estabelecimento')) return [EST];
      if (sql.includes('FROM alergeno'))
        return [
          { id: 3, descricao: 'CAMARÃO', natureza: 'alimento', tipo_alergia: null },
          { id: 4, descricao: 'LÁTEX', natureza: 'latex', tipo_alergia: 'Contato' },
        ];
      if (sql.includes('FROM principio_ativo')) return [{ id: 600, descricao: 'DIPIRONA' }];
      return [];
    });
    expect(await catalogoAlergias(nucleo, 'cli', C)).toEqual({
      agentes: [
        { id: 3, nome: 'CAMARÃO', tipo: 'Alimento' },
        { id: 4, nome: 'LÁTEX', tipo: 'Contato' },
      ],
      principios: [{ id: 600, nome: 'DIPIRONA' }],
    });
    expect(chamadas.find((x) => x.sql.includes('FROM alergeno'))!.sql).toContain('ag.ativo = TRUE');
  });

  it('registros: do atendimento, pelas inscrições da sessão, sem suspensos, o mais recente primeiro', async () => {
    const { nucleo, chamadas } = duble((sql) => {
      if (sql.includes('FROM estabelecimento')) return [EST];
      if (sql.includes('FROM registro_assistencial'))
        return [
          { id: 9, titulo: 'Evolução', data_hora_clinica: new Date('2026-11-23T13:00:00Z') },
          { id: 8, titulo: 'Anamnese', data_hora_clinica: null },
        ];
      return [];
    });
    const r = await registrosParaAlergia(nucleo, 'cli', C, 30, [5, 5, 6, -1]);
    expect(r).toEqual([
      { registro: 9, modelo: 'Evolução', dataHora: '2026-11-23T10:00:00' },
      { registro: 8, modelo: 'Anamnese', dataHora: null },
    ]);
    const sql = chamadas.at(-1)!;
    expect(sql.parametros).toEqual([30, 7, 5, 6]);
    expect(sql.sql).toContain('r.suspenso_em IS NULL');
    expect(sql.sql).toContain('ORDER BY r.data_hora_lancamento DESC');
  });

  it('registros sem inscrição: lista vazia sem ler o banco', async () => {
    const { nucleo, chamadas } = duble(() => []);
    expect(await registrosParaAlergia(nucleo, 'cli', C, 30, [])).toEqual([]);
    expect(chamadas).toHaveLength(0);
  });

  it('estabelecimento inexistente: 404', async () => {
    const { nucleo } = duble(() => []);
    await expect(alergias(nucleo, 'cli', C, 20)).rejects.toMatchObject({ problema: { status: 404 } });
  });
});
