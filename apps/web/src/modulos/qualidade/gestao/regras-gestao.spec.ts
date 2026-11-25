// Regras de tela da gestão da qualidade e dos envios regulatórios (M48, etapa 5): cada montagem conferida pelo mesmo
// esquema da API, as prévias com as parcelas (GUT, checklist, quórum) e o que cada situação permite. Dados SINTÉTICOS.
import { describe, expect, it } from 'vitest';
import {
  acoesDaManifestacao,
  acoesDoDocumento,
  checklistDoModelo,
  classeDaMeta,
  competenciaBr,
  competenciasRecentes,
  dataBr,
  enviosAtuais,
  formularioDaComissao,
  formularioDaNaoConformidade,
  formularioDoRisco,
  itemVazio,
  montarAnalise,
  montarAuditoria,
  montarComissao,
  montarEncaminhamento,
  montarManifestacao,
  montarNaoConformidade,
  montarPublicacao,
  montarResposta,
  montarRetirada,
  montarReuniao,
  montarRisco,
  montarTransmissao,
  novoControleRisco,
  previaChecklist,
  previaEficaciaControles,
  previaGut,
  previaQuorum,
  textoDoResumo,
  valorDoIndicador,
} from './regras-gestao.js';

const HASH = 'a'.repeat(64);

describe('competências e datas', () => {
  it('as 12 competências a partir da atual, a virada do ano e o formato brasileiro', () => {
    const c = competenciasRecentes('2026-02');
    expect(c).toHaveLength(12);
    expect(c.slice(0, 3)).toEqual(['2026-02', '2026-01', '2025-12']);
    expect(competenciaBr('2026-09')).toBe('09/2026');
    expect(dataBr('2026-10-27T10:00')).toBe('27/10/2026');
    expect(dataBr(null)).toBe('');
  });
});

describe('documentos', () => {
  const base = {
    codigo: 'pop-enf-001',
    tipo: 'pop',
    titulo: 'Higiene das mãos na assistência',
    area: 'Enfermagem',
    conteudo: 'Conteúdo sintético do procedimento com mais de vinte caracteres.',
    resumoAlteracao: '',
    elaboradoPor: 'sint.elaborador',
    revisadoPor: '',
    vigenciaAte: '2028-10-27',
    exigeCiencia: true,
  };
  it('o primeiro: código e login em maiúsculas, revisor vazio vira nulo, sem substituta', () => {
    const m = montarPublicacao(base, null);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.entrada.codigo).toBe('POP-ENF-001');
    expect(m.entrada.elaboradoPor).toBe('SINT.ELABORADOR');
    expect(m.entrada.revisadoPor).toBeNull();
    expect(m.entrada.substitui).toBeNull();
  });
  it('a nova revisão exige o resumo da alteração e leva a vigente com a versão', () => {
    const sem = montarPublicacao(base, { id: 5, versao: 2 });
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.erros.resumoAlteracao).toMatch(/o que mudou/);
    const com = montarPublicacao(
      { ...base, resumoAlteracao: 'Inclusão do quinto momento.' },
      { id: 5, versao: 2 },
    );
    expect(com.ok && com.entrada.substitui).toEqual({ id: 5, versao: 2 });
  });
  it('sem tipo e sem data de revisão não vai ao servidor', () => {
    const m = montarPublicacao({ ...base, tipo: '', vigenciaAte: null }, null);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(Object.keys(m.erros)).toEqual(expect.arrayContaining(['tipo', 'vigenciaAte']));
  });
  it('a retirada exige o motivo e sai sem o documento (vai no endereço)', () => {
    expect(montarRetirada({ id: 5, versao: 2 }, 'curto').ok).toBe(false);
    const m = montarRetirada({ id: 5, versao: 2 }, 'Substituído pelo protocolo institucional novo.');
    expect(m.ok && m.entrada).toEqual({
      versao: 2,
      motivo: 'Substituído pelo protocolo institucional novo.',
    });
  });
  it('ciência só na vigente que exige e ainda não foi dada; revisar e retirar só para quem publica e ligada', () => {
    const d = { situacao: 'vigente' as const, exigeCiencia: true, cienteSessao: false };
    expect(acoesDoDocumento(d, false, true)).toEqual({ ciencia: true, revisar: false, retirar: false });
    expect(acoesDoDocumento({ ...d, cienteSessao: true }, true, true)).toEqual({
      ciencia: false,
      revisar: true,
      retirar: true,
    });
    expect(acoesDoDocumento({ ...d, situacao: 'obsoleto' }, true, true).revisar).toBe(false);
    expect(acoesDoDocumento(d, true, false)).toEqual({ ciencia: false, revisar: false, retirar: false });
  });
});

describe('indicadores', () => {
  it('o valor na unidade da ficha e a classe da meta', () => {
    expect(valorDoIndicador(12.5, 'percentual')).toBe('12,5%');
    expect(valorDoIndicador(2.4, 'densidade')).toBe('2,4 por mil');
    expect(valorDoIndicador(4.25, 'dias')).toBe('4,25 dias');
    expect(valorDoIndicador(1234, 'quantidade')).toBe('1.234');
    expect(valorDoIndicador(null, 'razao')).toBe('—');
    expect(classeDaMeta('fora-da-meta')).toContain('vencido');
    expect(classeDaMeta('na-meta')).toContain('cumprido');
  });
  const ind = { competencia: '2026-09', situacaoMeta: 'na-meta' as const, analise: null };
  const f = {
    texto: 'Análise sintética do mês com mais de vinte caracteres.',
    causas: '',
    plano: '',
    responsavel: '',
    prazo: null,
  };
  it('na meta: só o texto; a inclusão vai sem ID e sem versão', () => {
    const m = montarAnalise(ind, f);
    expect(m.ok && m.entrada).toEqual({
      analise: null,
      versao: null,
      competencia: '2026-09',
      texto: f.texto,
      causas: null,
      plano: null,
      responsavel: null,
      prazo: null,
    });
  });
  it('fora da meta: causas, plano, responsável e prazo obrigatórios; a alteração leva a análise lida', () => {
    const fora = { ...ind, situacaoMeta: 'fora-da-meta' as const };
    const m = montarAnalise(fora, f);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(Object.keys(m.erros).sort()).toEqual(['causas', 'plano', 'prazo', 'responsavel']);
    const ok = montarAnalise(
      { ...fora, analise: { id: 9, versao: 3 } as never },
      {
        ...f,
        causas: 'Causa sintética.',
        plano: 'Plano sintético.',
        responsavel: 'SCIH',
        prazo: '2026-11-30',
      },
    );
    expect(ok.ok && [ok.entrada.analise, ok.entrada.versao]).toEqual([9, 3]);
  });
});

describe('auditorias', () => {
  it('o modelo traz os requisitos sem resultado; a prévia conta só os avaliados com as parcelas', () => {
    const itens = checklistDoModelo([
      { requisito: 'Requisito A', secao: 'Seção 1', resultado: 'conforme', evidencia: null },
      { requisito: 'Requisito B', secao: null, resultado: 'naoConforme', evidencia: 'achado' },
    ]);
    expect(itens).toEqual([
      { secao: 'Seção 1', requisito: 'Requisito A', resultado: '', evidencia: '' },
      { secao: '', requisito: 'Requisito B', resultado: '', evidencia: '' },
    ]);
    expect(previaChecklist(itens).conta).toBeNull();
    const p = previaChecklist([
      { ...itemVazio(), resultado: 'conforme' },
      { ...itemVazio(), resultado: 'parcial' },
      { ...itemVazio(), resultado: 'naoAplicavel' },
    ]);
    expect(p.conta).toBe('(1 + 0,5 × 1) ÷ 2 × 100 = 75%');
  });
  const f = {
    titulo: 'Auditoria sintética da UTI',
    area: 'UTI',
    referencial: 'ona',
    realizadaEm: '2026-10-20',
    auditores: 'Auditor sintético',
    conclusao: 'Conclusão sintética da auditoria.',
    itens: [
      { secao: '', requisito: 'Requisito sintético', resultado: 'naoConforme', evidencia: '' },
      { secao: '', requisito: '', resultado: '', evidencia: '' },
    ],
  };
  it('o não conforme sem evidência é recusado; a linha vazia é ignorada', () => {
    const m = montarAuditoria(f);
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.erros.item1).toMatch(/evidência/);
    const ok = montarAuditoria({
      ...f,
      itens: [{ ...f.itens[0]!, evidencia: 'Achado sintético.' }, f.itens[1]!],
    });
    expect(ok.ok && ok.entrada.itens).toEqual([
      {
        requisito: 'Requisito sintético',
        secao: null,
        resultado: 'naoConforme',
        evidencia: 'Achado sintético.',
      },
    ]);
  });
  it('sem requisito e sem referencial', () => {
    const m = montarAuditoria({ ...f, referencial: '', itens: [] });
    expect(m.ok).toBe(false);
    if (!m.ok) expect(Object.keys(m.erros)).toEqual(expect.arrayContaining(['referencial', 'itens']));
  });
});

describe('comissões', () => {
  it('a nova começa com um membro; o membro repetido é recusado; a alteração leva a versão', () => {
    const f = formularioDaComissao(null);
    expect(f.membros).toHaveLength(1);
    const g = {
      ...f,
      tipo: 'cciH'.toLowerCase(),
      nome: 'Comissão sintética',
      periodicidade: 'mensal',
      membros: [
        { nome: 'Membro Um', funcao: 'Presidente', login: '' },
        { nome: 'membro um', funcao: 'Secretária', login: '' },
      ],
    };
    const rep = montarComissao(g, null);
    expect(rep.ok).toBe(false);
    if (!rep.ok) expect(rep.erros.membros).toMatch(/duas vezes/);
    // Revisão do W0-04: a alteração exige a justificativa (a composição anterior vai ao histórico).
    const membros = [g.membros[0]!, { nome: 'Membro Dois', funcao: 'Secretária', login: 'sint.dois' }];
    const sem = montarComissao({ ...g, membros }, { id: 3, versao: 4 });
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(Object.keys(sem.erros)).toContain('justificativa');
    const ok = montarComissao({ ...g, membros, justificativa: 'Troca da secretária' }, { id: 3, versao: 4 });
    expect(ok.ok && [ok.entrada.comissao, ok.entrada.versao, ok.entrada.membros[1]?.login]).toEqual([
      3,
      4,
      'SINT.DOIS',
    ]);
  });
  it('o quórum por maioria simples com as parcelas e a reunião com os presentes ordenados', () => {
    expect(previaQuorum(4, 2)).toEqual({ quorum: false, conta: '2 presentes de 4 membros' });
    expect(previaQuorum(4, 3).quorum).toBe(true);
    const c = { id: 3, versao: 2, membros: [{}, {}, {}] as never };
    const f = {
      tipo: 'ordinaria',
      data: '2026-10-20',
      hora: '14:00',
      pauta: 'Pauta sintética',
      ata: 'Ata sintética com mais de vinte caracteres.',
      presentes: [2, 0],
      convidados: '',
      deliberacoes: '',
    };
    const m = montarReuniao(f, c);
    expect(m.ok && m.entrada).toEqual({
      versaoComissao: 2,
      tipo: 'ordinaria',
      realizadaEm: '2026-10-20T14:00',
      pauta: 'Pauta sintética',
      ata: f.ata,
      presentes: [0, 2],
      convidados: null,
      deliberacoes: null,
    });
    const sem = montarReuniao({ ...f, presentes: [], hora: null }, c);
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(Object.keys(sem.erros)).toEqual(expect.arrayContaining(['presentes', 'realizadaEm']));
  });
});

describe('riscos e não conformidades', () => {
  it('a pontuação G × U × T e a prioridade pelos limites da escala', () => {
    expect(previaGut(4, 4, 4)).toEqual({ pontuacao: 64, prioridade: 'critica', conta: '4 × 4 × 4 = 64' });
    expect(previaGut(3, 3, 3)?.prioridade).toBe('alta');
    expect(previaGut(2, 2, 2)?.prioridade).toBe('moderada');
    expect(previaGut(1, 1, 7)).toBeNull();
    expect(previaGut(0, 1, 1)).toBeNull();
  });
  it('o risco sem eixos não vai; o aceito exige a justificativa', () => {
    const f = {
      ...formularioDoRisco(null),
      titulo: 'Risco sintético de queda',
      descricao: 'Descrição sintética do risco.',
      area: 'Internação',
      categoria: 'assistencial',
      responsavel: 'Coordenação',
      reavaliarEm: '2027-01-31',
    };
    const sem = montarRisco(f, null);
    expect(sem.ok).toBe(false);
    if (!sem.ok) expect(sem.erros.gut).toBeDefined();
    const aceito = montarRisco({ ...f, gravidade: 2, urgencia: 2, tendencia: 1, situacao: 'aceito' }, null);
    expect(aceito.ok).toBe(false);
    if (!aceito.ok) expect(aceito.erros.justificativa).toBeDefined();
    const ok = montarRisco({ ...f, gravidade: 5, urgencia: 4, tendencia: 3 }, { id: 8, versao: 2 });
    expect(ok.ok && [ok.entrada.risco, ok.entrada.versao, ok.entrada.controles]).toEqual([8, 2, null]);
  });
  it('C2-060: os controles estruturados vão com nome, tipo e eficácia; sem nome, repetido ou mitigado sem eficaz, não vão', () => {
    const f = {
      ...formularioDoRisco(null),
      titulo: 'Risco sintético de queda',
      descricao: 'Descrição sintética do risco.',
      area: 'Internação',
      categoria: 'assistencial',
      responsavel: 'Coordenação',
      reavaliarEm: '2027-01-31',
      gravidade: 3,
      urgencia: 3,
      tendencia: 3,
    };
    const barra = { nome: 'Barra de apoio', tipo: 'preventivo' as const, eficacia: 'eficaz' as const };
    const semNome = montarRisco({ ...f, controlesLista: [novoControleRisco()] }, null);
    expect(!semNome.ok && semNome.erros.controlesLista).toBeTruthy();
    const repetido = montarRisco(
      { ...f, controlesLista: [barra, { ...barra, nome: ' barra de apóio' }] },
      null,
    );
    expect(!repetido.ok && repetido.erros.controlesLista).toContain('duas vezes');
    const mitigado = montarRisco(
      { ...f, situacao: 'mitigado', controlesLista: [{ ...barra, eficacia: 'ineficaz' }] },
      null,
    );
    expect(!mitigado.ok && mitigado.erros.controlesLista).toContain('eficaz');
    const ok = montarRisco({ ...f, controlesLista: [{ ...barra, nome: ' Barra de apoio ' }] }, null);
    expect(ok.ok && ok.entrada.controlesLista).toEqual([barra]);
    expect(previaEficaciaControles([barra, { ...barra, nome: 'Ronda', eficacia: 'ineficaz' }])).toBe(
      'parcialmenteEficaz',
    );
    expect(previaEficaciaControles([novoControleRisco()])).toBe('semControle');
  });
  it('a não conformidade aberta da auditoria leva o registro; em tratamento exige o plano; encerrada, a eficácia', () => {
    const f = {
      ...formularioDaNaoConformidade(null, { origem: 'auditoria', id: 12 }),
      descricao: 'Não conformidade sintética.',
      area: 'UTI',
      classificacao: 'maior',
    };
    expect(f.idOrigem).toBe('12');
    const aberta = montarNaoConformidade(f, null);
    expect(aberta.ok && [aberta.entrada.origem, aberta.entrada.idOrigem, aberta.entrada.prazo]).toEqual([
      'auditoria',
      12,
      null,
    ]);
    const trat = montarNaoConformidade({ ...f, situacao: 'emTratamento' }, { id: 4, versao: 1 });
    expect(trat.ok).toBe(false);
    if (!trat.ok) expect(Object.keys(trat.erros).sort()).toEqual(['causa', 'plano', 'prazo', 'responsavel']);
    const enc = montarNaoConformidade(
      { ...f, situacao: 'encerrada', causa: 'c', plano: 'p', responsavel: 'r', prazo: '2026-11-30' },
      { id: 4, versao: 2 },
    );
    expect(enc.ok).toBe(false);
    if (!enc.ok) expect(enc.erros.eficacia).toBeDefined();
    const externa = montarNaoConformidade({ ...f, origem: 'externa', idOrigem: '99' }, null);
    expect(externa.ok && externa.entrada.idOrigem).toBeNull();
    const ruim = montarNaoConformidade({ ...f, idOrigem: 'abc' }, null);
    expect(ruim.ok).toBe(false);
  });
});

describe('ouvidoria', () => {
  const f = {
    canal: 'telefone',
    tipo: 'reclamacao',
    identificada: false,
    paciente: 77,
    manifestante: 'Nome digitado',
    contato: '99999',
    area: 'Recepção',
    relato: 'Relato sintético da manifestação.',
    data: '2026-10-27',
    hora: '08:30',
    pesquisa: null,
  };
  it('a anônima sai sem paciente, nome e contato, mesmo que tenham sido digitados', () => {
    const m = montarManifestacao(f);
    expect(m.ok && [m.entrada.paciente, m.entrada.manifestante, m.entrada.contato]).toEqual([
      null,
      null,
      null,
    ]);
    expect(m.ok && m.entrada.recebidaEm).toBe('2026-10-27T08:30');
  });
  it('a identificada exige o paciente ou o nome; a da pesquisa vai pelo canal da pesquisa', () => {
    const sem = montarManifestacao({ ...f, identificada: true, paciente: null, manifestante: '' });
    expect(sem.ok).toBe(false);
    const pesq = montarManifestacao({
      ...f,
      canal: 'pesquisa',
      identificada: true,
      paciente: null,
      manifestante: '',
      pesquisa: 31,
    });
    expect(pesq.ok && pesq.entrada.pesquisa).toBe(31);
    const canalErrado = montarManifestacao({ ...f, pesquisa: 31 });
    expect(canalErrado.ok).toBe(false);
  });
  it('encaminhar e responder: a reclamação diz se procede; o elogio não leva procedência', () => {
    const m = { id: 5, versao: 2, tipo: 'reclamacao' as const };
    expect(montarEncaminhamento(m, 'Recepção', '').ok && true).toBe(true);
    const sem = montarResposta(m, 'Resposta sintética ao manifestante.', '');
    expect(sem.ok).toBe(false);
    const ok = montarResposta(m, 'Resposta sintética ao manifestante.', 'nao');
    expect(ok.ok && ok.entrada).toEqual({
      versao: 2,
      resposta: 'Resposta sintética ao manifestante.',
      procedente: false,
    });
    const elogio = montarResposta({ ...m, tipo: 'elogio' }, 'Agradecemos o elogio sintético.', 'sim');
    expect(elogio.ok && elogio.entrada.procedente).toBeNull();
  });
  it('encaminhar só a aberta; responder a aberta e a encaminhada; nada sem a permissão', () => {
    expect(acoesDaManifestacao('aberta', true)).toEqual({ encaminhar: true, responder: true });
    expect(acoesDaManifestacao('encaminhada', true)).toEqual({ encaminhar: false, responder: true });
    expect(acoesDaManifestacao('respondida', true)).toEqual({ encaminhar: false, responder: false });
    expect(acoesDaManifestacao('aberta', false)).toEqual({ encaminhar: false, responder: false });
  });
});

describe('envios regulatórios', () => {
  it('o resumo em texto, os atuais sem os substituídos', () => {
    expect(textoDoResumo({ notificacoes: 1200, obitos: 2 })).toBe('notificacoes: 1.200; obitos: 2');
    expect(enviosAtuais([{ situacao: 'substituido' }, { situacao: 'gerado' }] as never)).toHaveLength(1);
  });
  it('a transmissão confere o resumo com o gerado (maiúsculas aceitas) e exige data e protocolo', () => {
    const e = { id: 3, versao: 1, hash: HASH };
    const ok = montarTransmissao(e, {
      data: '2026-10-27',
      hora: '10:00',
      protocolo: 'PROT-123',
      hash: HASH.toUpperCase(),
    });
    expect(ok.ok && ok.entrada).toEqual({
      versao: 1,
      transmitidoEm: '2026-10-27T10:00',
      protocolo: 'PROT-123',
      hash: HASH,
    });
    const outro = montarTransmissao(e, {
      data: '2026-10-27',
      hora: '10:00',
      protocolo: 'PROT-123',
      hash: 'b'.repeat(64),
    });
    expect(outro.ok).toBe(false);
    if (!outro.ok) expect(outro.erros.hash).toMatch(/não é o do arquivo gerado/);
    const vazio = montarTransmissao(e, { data: null, hora: null, protocolo: '', hash: '' });
    expect(vazio.ok).toBe(false);
    if (!vazio.ok)
      expect(Object.keys(vazio.erros)).toEqual(
        expect.arrayContaining(['transmitidoEm', 'protocolo', 'hash']),
      );
  });
});
