// W0-03, mercado M1 (programa CRUD completo; plano-final.json, item W0-03): as escalas que o mercado de SGH oferece e que
// faltavam ao motor de escores do M45 — risco de tromboembolismo venoso (Caprini e Padua), pediatria e neonatologia
// (PEWS, Braden Q, Humpty Dumpty, NIPS e FLACC) e obstetrícia (MEOWS). Os itens e os pontos são os das publicações
// originais (domínio público; nenhum conteúdo licenciado), traduzidos; o total é sempre calculado pelo servidor
// (regra 3 do M45) e as faixas são regra versionada (regras.ts do domínio). Nenhum nome de tabela nem do sistema
// anterior em texto visto pelo usuário (ADR 0023).

export interface OpcaoEscalaMercado {
  readonly valor: number;
  readonly rotulo: string;
}
export interface ItemEscalaMercado {
  readonly codigo: string;
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoEscalaMercado[];
}

const op = (valor: number, rotulo: string): OpcaoEscalaMercado => ({ valor, rotulo });
/** Fator de risco presente ou ausente, com o peso da publicação. */
const fator = (codigo: string, rotulo: string, pontos: number): ItemEscalaMercado => ({
  codigo,
  rotulo: `${rotulo} (${pontos} ${pontos === 1 ? 'ponto' : 'pontos'})`,
  opcoes: [op(0, 'Não'), op(pontos, 'Sim')],
});

/**
 * Caprini (Caprini, Dis Mon 2005;51:70-78; faixas de Gould et al., Chest 2012;141(2 Suppl):e227S): a idade em quatro
 * faixas e os fatores de risco com 1, 2, 3 ou 5 pontos. Códigos curtos: os itens vão inteiros ao registro.
 */
export const ITENS_CAPRINI: readonly ItemEscalaMercado[] = [
  {
    codigo: 'idade',
    rotulo: 'Idade',
    opcoes: [
      op(0, '40 anos ou menos'),
      op(1, '41 a 60 anos'),
      op(2, '61 a 74 anos'),
      op(3, '75 anos ou mais'),
    ],
  },
  fator('cirMenor', 'Cirurgia menor', 1),
  fator('imc25', 'Índice de massa corporal acima de 25', 1),
  fator('edemaMmii', 'Edema dos membros inferiores', 1),
  fator('varizes', 'Varizes', 1),
  fator('gestPuerp', 'Gestação ou puerpério', 1),
  fator('abortoRep', 'Aborto espontâneo recorrente ou sem causa conhecida', 1),
  fator('hormonio', 'Anticoncepcional oral ou terapia de reposição hormonal', 1),
  fator('sepse1m', 'Sepse há menos de 1 mês', 1),
  fator('pulmao1m', 'Doença pulmonar grave, inclusive pneumonia, há menos de 1 mês', 1),
  fator('funcPulm', 'Função pulmonar alterada', 1),
  fator('iam', 'Infarto agudo do miocárdio', 1),
  fator('icc1m', 'Insuficiência cardíaca congestiva há menos de 1 mês', 1),
  fator('dii', 'Doença inflamatória intestinal', 1),
  fator('clinRepou', 'Paciente clínico em repouso no leito', 1),
  fator('artrosc', 'Cirurgia artroscópica', 2),
  fator('cirMaior', 'Cirurgia aberta maior (mais de 45 minutos)', 2),
  fator('laparo', 'Cirurgia laparoscópica (mais de 45 minutos)', 2),
  fator('neoplasia', 'Neoplasia maligna', 2),
  fator('acamado72', 'Restrito ao leito há mais de 72 horas', 2),
  fator('gesso', 'Imobilização com gesso', 2),
  fator('cvc', 'Acesso venoso central', 2),
  fator('tevPrev', 'Tromboembolismo venoso prévio', 3),
  fator('tevFamil', 'História familiar de tromboembolismo venoso', 3),
  fator('fatorVL', 'Fator V de Leiden', 3),
  fator('protromb', 'Mutação 20210A da protrombina', 3),
  fator('lupico', 'Anticoagulante lúpico', 3),
  fator('anticard', 'Anticorpos anticardiolipina', 3),
  fator('homocist', 'Homocisteína sérica elevada', 3),
  fator('hit', 'Trombocitopenia induzida por heparina', 3),
  fator('trombof', 'Outra trombofilia congênita ou adquirida', 3),
  fator('avc1m', 'Acidente vascular cerebral há menos de 1 mês', 5),
  fator('artropl', 'Artroplastia eletiva de membro inferior', 5),
  fator('fratura', 'Fratura de quadril, pelve ou perna', 5),
  fator('medula1m', 'Lesão aguda de medula espinhal há menos de 1 mês', 5),
];

/** Padua (Barbar et al., J Thromb Haemost 2010;8:2450-7): onze fatores; 4 ou mais é alto risco no paciente clínico. */
export const ITENS_PADUA: readonly ItemEscalaMercado[] = [
  fator('cancer', 'Câncer ativo', 3),
  fator('tevPrev', 'Tromboembolismo venoso prévio (exceto trombose venosa superficial)', 3),
  fator('mobilidade', 'Mobilidade reduzida (repouso no leito por 3 dias ou mais)', 3),
  fator('trombof', 'Condição trombofílica conhecida', 3),
  fator('trauma1m', 'Trauma ou cirurgia recente (1 mês ou menos)', 2),
  fator('idade70', 'Idade de 70 anos ou mais', 1),
  fator('icResp', 'Insuficiência cardíaca ou respiratória', 1),
  fator('iamAvc', 'Infarto agudo do miocárdio ou acidente vascular cerebral isquêmico', 1),
  fator('infecReum', 'Infecção aguda ou doença reumatológica', 1),
  fator('obesidade', 'Obesidade (índice de massa corporal de 30 ou mais)', 1),
  fator('hormonio', 'Tratamento hormonal em curso', 1),
];

/** PEWS de Brighton (Monaghan, Paediatr Nurs 2005;17(1):32-5): comportamento, cardiovascular e respiratório, mais os acréscimos. */
export const ITENS_PEWS: readonly ItemEscalaMercado[] = [
  {
    codigo: 'comport',
    rotulo: 'Comportamento',
    opcoes: [
      op(0, 'Brincando ou adequado'),
      op(1, 'Dormindo'),
      op(2, 'Irritado'),
      op(3, 'Letárgico, confuso ou com resposta reduzida à dor'),
    ],
  },
  {
    codigo: 'cardio',
    rotulo: 'Cardiovascular',
    opcoes: [
      op(0, 'Corado ou enchimento capilar de 1 a 2 segundos'),
      op(1, 'Pálido ou enchimento capilar de 3 segundos'),
      op(2, 'Acinzentado, enchimento de 4 segundos ou taquicardia 20 acima do normal'),
      op(
        3,
        'Acinzentado e moteado, enchimento de 5 segundos ou mais, taquicardia 30 acima do normal ou bradicardia',
      ),
    ],
  },
  {
    codigo: 'resp',
    rotulo: 'Respiratório',
    opcoes: [
      op(0, 'Dentro do normal, sem retração'),
      op(1, 'Mais de 10 acima do normal, musculatura acessória ou O₂ a 30% ou 3 L/min'),
      op(2, 'Mais de 20 acima do normal, retração ou O₂ a 40% ou 6 L/min'),
      op(3, '5 abaixo do normal com retração ou gemência, ou O₂ a 50% ou 8 L/min'),
    ],
  },
  { codigo: 'nebul', rotulo: 'Nebulização a cada 15 minutos', opcoes: [op(0, 'Não'), op(2, 'Sim')] },
  {
    codigo: 'vomito',
    rotulo: 'Vômitos persistentes no pós-operatório',
    opcoes: [op(0, 'Não'), op(2, 'Sim')],
  },
];

/** Braden Q (Quigley e Curley, J Soc Pediatr Nurs 1996;1(1):7-18; corte de 16 em Curley et al., Nurs Res 2003). */
export const ITENS_BRADEN_Q: readonly ItemEscalaMercado[] = [
  {
    codigo: 'mobilidade',
    rotulo: 'Mobilidade',
    opcoes: [
      op(1, 'Completamente imóvel'),
      op(2, 'Muito limitada'),
      op(3, 'Levemente limitada'),
      op(4, 'Sem limitação'),
    ],
  },
  {
    codigo: 'atividade',
    rotulo: 'Atividade',
    opcoes: [
      op(1, 'Acamado'),
      op(2, 'Restrito à cadeira'),
      op(3, 'Anda ocasionalmente'),
      op(4, 'Todos os pacientes jovens demais para andar ou anda frequentemente'),
    ],
  },
  {
    codigo: 'percepcao',
    rotulo: 'Percepção sensorial',
    opcoes: [
      op(1, 'Completamente limitada'),
      op(2, 'Muito limitada'),
      op(3, 'Levemente limitada'),
      op(4, 'Sem alteração'),
    ],
  },
  {
    codigo: 'umidade',
    rotulo: 'Umidade',
    opcoes: [
      op(1, 'Constantemente úmida'),
      op(2, 'Frequentemente úmida'),
      op(3, 'Ocasionalmente úmida'),
      op(4, 'Raramente úmida'),
    ],
  },
  {
    codigo: 'friccao',
    rotulo: 'Fricção e cisalhamento',
    opcoes: [
      op(1, 'Problema importante'),
      op(2, 'Problema'),
      op(3, 'Problema potencial'),
      op(4, 'Nenhum problema aparente'),
    ],
  },
  {
    codigo: 'nutricao',
    rotulo: 'Nutrição',
    opcoes: [op(1, 'Muito pobre'), op(2, 'Inadequada'), op(3, 'Adequada'), op(4, 'Excelente')],
  },
  {
    codigo: 'perfusao',
    rotulo: 'Perfusão tecidual e oxigenação',
    opcoes: [
      op(1, 'Extremamente comprometida'),
      op(2, 'Comprometida'),
      op(3, 'Adequada'),
      op(4, 'Excelente'),
    ],
  },
];

/** Humpty Dumpty (Hill-Rodriguez et al., J Spec Pediatr Nurs 2009;14(1):22-32): sete parâmetros; 12 ou mais é alto risco. */
export const ITENS_HUMPTY: readonly ItemEscalaMercado[] = [
  {
    codigo: 'idade',
    rotulo: 'Idade',
    opcoes: [
      op(4, 'Menos de 3 anos'),
      op(3, 'De 3 a menos de 7 anos'),
      op(2, 'De 7 a menos de 13 anos'),
      op(1, '13 anos ou mais'),
    ],
  },
  { codigo: 'sexo', rotulo: 'Sexo', opcoes: [op(2, 'Masculino'), op(1, 'Feminino')] },
  {
    codigo: 'diagnostico',
    rotulo: 'Diagnóstico',
    opcoes: [
      op(4, 'Neurológico'),
      op(3, 'Alteração da oxigenação (respiratório, desidratação, anemia, anorexia, síncope ou tontura)'),
      op(2, 'Psiquiátrico ou de comportamento'),
      op(1, 'Outro diagnóstico'),
    ],
  },
  {
    codigo: 'cognicao',
    rotulo: 'Comprometimento cognitivo',
    opcoes: [
      op(3, 'Não tem consciência das limitações'),
      op(2, 'Esquece as limitações'),
      op(1, 'Orientado quanto à própria capacidade'),
    ],
  },
  {
    codigo: 'ambiente',
    rotulo: 'Fatores ambientais',
    opcoes: [
      op(4, 'História de queda ou lactente ou criança pequena colocado em cama'),
      op(3, 'Usa dispositivos de auxílio ou lactente ou criança pequena em berço'),
      op(2, 'Paciente em cama'),
      op(1, 'Área ambulatorial'),
    ],
  },
  {
    codigo: 'cirurgia',
    rotulo: 'Resposta a cirurgia, sedação ou anestesia',
    opcoes: [
      op(3, 'Nas últimas 24 horas'),
      op(2, 'Nas últimas 48 horas'),
      op(1, 'Há mais de 48 horas ou nenhuma'),
    ],
  },
  {
    codigo: 'medicacao',
    rotulo: 'Uso de medicamentos',
    opcoes: [
      op(
        3,
        'Vários: sedativos, hipnóticos, barbitúricos, fenotiazinas, antidepressivos, laxantes, diuréticos ou opioides',
      ),
      op(2, 'Um dos medicamentos acima'),
      op(1, 'Outros medicamentos ou nenhum'),
    ],
  },
];

/** NIPS (Lawrence et al., Neonatal Netw 1993;12(6):59-66): dor no recém-nascido; mais de 3 indica dor. */
export const ITENS_NIPS: readonly ItemEscalaMercado[] = [
  { codigo: 'face', rotulo: 'Expressão facial', opcoes: [op(0, 'Relaxada'), op(1, 'Contraída')] },
  { codigo: 'choro', rotulo: 'Choro', opcoes: [op(0, 'Ausente'), op(1, 'Resmungo'), op(2, 'Vigoroso')] },
  { codigo: 'respiracao', rotulo: 'Respiração', opcoes: [op(0, 'Relaxada'), op(1, 'Diferente do basal')] },
  {
    codigo: 'bracos',
    rotulo: 'Braços',
    opcoes: [op(0, 'Relaxados ou contidos'), op(1, 'Fletidos ou estendidos')],
  },
  {
    codigo: 'pernas',
    rotulo: 'Pernas',
    opcoes: [op(0, 'Relaxadas ou contidas'), op(1, 'Fletidas ou estendidas')],
  },
  { codigo: 'alerta', rotulo: 'Estado de alerta', opcoes: [op(0, 'Dormindo ou calmo'), op(1, 'Agitado')] },
];

/** FLACC (Merkel et al., Pediatr Nurs 1997;23(3):293-7): dor na criança que não verbaliza; 0 a 10. */
export const ITENS_FLACC: readonly ItemEscalaMercado[] = [
  {
    codigo: 'face',
    rotulo: 'Face',
    opcoes: [
      op(0, 'Sem expressão particular ou sorriso'),
      op(1, 'Careta ou sobrancelhas franzidas de vez em quando, introversão, desinteresse'),
      op(2, 'Tremor frequente do queixo, mandíbulas cerradas'),
    ],
  },
  {
    codigo: 'pernas',
    rotulo: 'Pernas',
    opcoes: [
      op(0, 'Posição normal ou relaxadas'),
      op(1, 'Inquietas, agitadas, tensas'),
      op(2, 'Chutando ou esticadas'),
    ],
  },
  {
    codigo: 'atividade',
    rotulo: 'Atividade',
    opcoes: [
      op(0, 'Deitada quieta, posição normal, move-se facilmente'),
      op(1, 'Contorcendo-se, movendo-se para frente e para trás, tensa'),
      op(2, 'Curvada, rígida ou com movimentos bruscos'),
    ],
  },
  {
    codigo: 'choro',
    rotulo: 'Choro',
    opcoes: [
      op(0, 'Sem choro'),
      op(1, 'Gemidos ou choramingos, queixa ocasional'),
      op(2, 'Choro continuado, grito ou soluço'),
    ],
  },
  {
    codigo: 'consolo',
    rotulo: 'Consolabilidade',
    opcoes: [
      op(0, 'Satisfeita, relaxada'),
      op(1, 'Tranquilizada por toques, abraços ou conversa ocasional'),
      op(2, 'Difícil de consolar ou confortar'),
    ],
  },
];

/**
 * MEOWS (Singh et al., Anaesthesia 2012;67:12-18): sete parâmetros com a faixa amarela (1 ponto) e a vermelha (2
 * pontos). O gatilho da publicação, "um vermelho ou dois amarelos", é o total de 2 ou mais.
 */
export const ITENS_MEOWS: readonly ItemEscalaMercado[] = [
  {
    codigo: 'temp',
    rotulo: 'Temperatura (°C)',
    opcoes: [
      op(0, 'De 36 a 38'),
      op(1, 'Amarela: de 35 a 36'),
      op(2, 'Vermelha: abaixo de 35 ou acima de 38'),
    ],
  },
  {
    codigo: 'pas',
    rotulo: 'Pressão sistólica (mmHg)',
    opcoes: [
      op(0, 'De 100 a 150'),
      op(1, 'Amarela: de 150 a 160 ou de 90 a 100'),
      op(2, 'Vermelha: abaixo de 90 ou acima de 160'),
    ],
  },
  {
    codigo: 'pad',
    rotulo: 'Pressão diastólica (mmHg)',
    opcoes: [op(0, 'Até 90'), op(1, 'Amarela: de 90 a 100'), op(2, 'Vermelha: acima de 100')],
  },
  {
    codigo: 'fc',
    rotulo: 'Frequência cardíaca (bpm)',
    opcoes: [
      op(0, 'De 50 a 100'),
      op(1, 'Amarela: de 100 a 120 ou de 40 a 50'),
      op(2, 'Vermelha: abaixo de 40 ou acima de 120'),
    ],
  },
  {
    codigo: 'fr',
    rotulo: 'Frequência respiratória (irpm)',
    opcoes: [
      op(0, 'De 10 a 20'),
      op(1, 'Amarela: de 21 a 30'),
      op(2, 'Vermelha: abaixo de 10 ou acima de 30'),
    ],
  },
  {
    codigo: 'spo2',
    rotulo: 'Saturação de O₂ (%)',
    opcoes: [op(0, '95 ou mais'), op(2, 'Vermelha: abaixo de 95')],
  },
  {
    codigo: 'consciencia',
    rotulo: 'Nível de consciência',
    opcoes: [
      op(0, 'Alerta'),
      op(1, 'Amarela: responde à voz'),
      op(2, 'Vermelha: responde à dor ou não responde'),
    ],
  },
];

// ── Profilaxia de tromboembolismo venoso (pendência ao prescritor) ────────────────────────────

/** As escalas de risco de TEV: o estabelecimento escolhe, por parâmetro, a do paciente clínico e a do cirúrgico. */
export const ESCALAS_TEV = ['caprini', 'padua'] as const;
export type EscalaTev = (typeof ESCALAS_TEV)[number];
export const PERFIS_TEV = ['clinico', 'cirurgico'] as const;
export type PerfilTev = (typeof PERFIS_TEV)[number];
export const ROTULOS_PERFIL_TEV: Readonly<Record<PerfilTev, string>> = {
  clinico: 'Paciente clínico',
  cirurgico: 'Paciente cirúrgico',
};

/** O código da decisão do prescritor sobre a profilaxia sugerida (uma por escore). */
export const CUIDADO_PROFILAXIA_TEV = 'profilaxiaTev';
export const DECISOES_PROFILAXIA = ['prescrita', 'nao-prescrita'] as const;
export type DecisaoProfilaxia = (typeof DECISOES_PROFILAXIA)[number];
export const ROTULOS_DECISAO_PROFILAXIA: Readonly<Record<DecisaoProfilaxia, string>> = {
  prescrita: 'Profilaxia prescrita',
  'nao-prescrita': 'Profilaxia não prescrita (com o motivo)',
};
