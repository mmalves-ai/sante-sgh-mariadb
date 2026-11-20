// Regra 2 do M27 sobre a cópia (só leitura): a fila do médico mostra só os pacientes com vínculo assistencial — o
// atendimento é de um CBO do médico, ele registrou no episódio ou aceitou parecer dele; fora disso, nada aparece; quem
// não está no cadastro de profissionais não tem fila. Com o médico de mais internados abertos da cópia (login e
// pacientes só em memória), cada linha é conferida contra o banco e o tempo vai à saída (meta: p95 < 1,5 s para 100
// pacientes). Só contagens.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { condicaoLoginDoProfissional, fonteCatalogoArquivo, loginsComProfissional } from '@sgh/legado';
import {
  type AmbienteM27,
  ambienteM27,
  caminhoCatalogo,
  NA_COPIA,
  percentil,
} from '../../acesso/aplicacao/copia.spec-util.js';
import { portaDocumentosLegado } from '../documentos-porta-legado.js';
import { ServicoDocumentos } from '../documentos-servico.js';
import { portaPrescricaoLegado } from '../prescricao-porta-legado.js';
import { portaWorklistLegado } from '../worklist-porta.js';
import { ServicoWorklistMedico } from './worklist-medico.js';

describe.skipIf(!NA_COPIA)('fila do médico só com vínculo assistencial (cópia, só leitura)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  });
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('a fila de cada médico é exatamente o conjunto com vínculo; sem cadastro de profissional, a fila é vazia', async () => {
    const catalogo = fonteCatalogoArquivo(caminhoCatalogo);
    const servico = new ServicoWorklistMedico(
      new ServicoDocumentos(portaDocumentosLegado(a.nucleo, catalogo)),
      portaPrescricaoLegado(a.nucleo, catalogo),
      portaWorklistLegado(a.nucleo),
    );
    // Os logins ligados ao cadastro de profissionais (só em memória). A cópia neutralizada tem poucos logins ligados, e
    // um login pode estar em vários cadastros: a fila usa o primeiro cadastro do login (como o registro clínico do M23).
    const logins = await a.nucleo.lerSomente({ ...a.c, traceId: 'int-m27-wl' }, async (l) =>
      (await loginsComProfissional(l, 20)).map((x) => String(x)),
    );
    expect(logins.length).toBeGreaterThan(0);
    // O esperado, calculado à parte no banco: atendimentos abertos (internação sem alta médica ou externo das últimas
    // 24 h) do CBO ativo do primeiro cadastro do login (no cabeçalho ou, na internação, como médico assistente), ou com
    // evolução desse CBO no episódio, ou com parecer aceito.
    const esperado = async (login: string) =>
      a.nucleo.lerSomente({ ...a.c, traceId: 'int-m27-wl' }, async (l) =>
        (
          await l.consultar(
            `SELECT FIRST 101 t.ID FROM ATCABECATEND t JOIN RICADPAC r ON r.ID = t.ID_RICADPAC
              WHERE COALESCE(t.ATIVO, 'T') = 'T'
                AND ((t.TP_ATENDIMENTO = 'I' AND t.DATA_HORA_ALTA_MEDICA IS NULL)
                  OR (t.TP_ATENDIMENTO = 'E' AND t.DATA_HORA_ENTRADA >= DATEADD(-24 HOUR TO CURRENT_TIMESTAMP)))
                AND (t.ID_TBCBOPRO_ATENDIMENTO IN (SELECT c.ID FROM TBCBOPRO c WHERE COALESCE(c.ATIVO, 'T') <> 'F'
                       AND c.ID_TBPROFIS = (SELECT MIN(f.ID) FROM TBPROFIS f WHERE ${condicaoLoginDoProfissional('f')}))
                  OR (t.TP_ATENDIMENTO = 'I' AND EXISTS (SELECT 1 FROM RICADINT i JOIN TBCBOPRO c ON c.ID = i.ID_TBCBOPRO_MEDASS
                       WHERE i.REG = t.COD_ATENDIMENTO AND COALESCE(c.ATIVO, 'T') <> 'F'
                         AND c.ID_TBPROFIS = (SELECT MIN(f.ID) FROM TBPROFIS f WHERE ${condicaoLoginDoProfissional('f')})))
                  OR EXISTS (SELECT 1 FROM HTATENDIMENTO h JOIN PRCABEVOL e ON e.ID_HTATENDIMENTO = h.ID
                              JOIN TBCBOPRO c ON c.ID = e.ID_TBCBOPRO_EVOLUCAO
                             WHERE h.ID_ATCABECATEND = t.ID AND COALESCE(c.ATIVO, 'T') <> 'F'
                               AND c.ID_TBPROFIS = (SELECT MIN(f.ID) FROM TBPROFIS f WHERE ${condicaoLoginDoProfissional('f')}))
                  OR EXISTS (SELECT 1 FROM SGH_PEP_FLUXO x WHERE x.HOSPITAL = ? AND x.ID_ATCABECATEND = t.ID
                               AND x.ACEITO_POR = ?))`,
            [login, login, login, a.cod, login],
            { teto: 101 },
          )
        ).map((x) => Number(x['ID'])),
      );
    const tempos: number[] = [];
    let comFila = 0;
    let linhas = 0;
    let divergentes = 0;
    for (const login of logins) {
      const t0 = performance.now();
      const fila = await servico.fila(a.c, login);
      tempos.push(performance.now() - t0);
      expect(fila.pacientes.length).toBeLessThanOrEqual(100);
      const obtido = fila.pacientes.map((p) => p.atendimento).sort((x, y) => x - y);
      const certo = (await esperado(login)).slice(0, 100).sort((x, y) => x - y);
      if (!fila.limitado && JSON.stringify(obtido) !== JSON.stringify(certo)) divergentes++;
      if (fila.limitado && obtido.some((x) => !certo.includes(x))) divergentes++;
      if (obtido.length > 0) comFila++;
      linhas += obtido.length;
    }
    expect(divergentes).toBe(0);
    // Seção 4 da ficha: p95 < 1,5 s (100 pacientes).
    expect(percentil(tempos, 95)).toBeLessThan(1500);
    // Quem não está no cadastro de profissionais: nenhum vínculo.
    const ninguem = await servico.fila(a.c, 'SGH.SEM.VINCULO.M27');
    expect(ninguem).toMatchObject({ semVinculo: true, pacientes: [] });
    const fmt = (x: number) => (x < 5 ? '<5' : String(x));
    console.log(
      `[int-m27] fila do médico: ${fmt(logins.length)} login(s) conferido(s), ${fmt(comFila)} com fila, ${fmt(linhas)} linha(s), 0 fora do vínculo; p95 ${Math.round(percentil(tempos, 95))} ms`,
    );
  });
});
