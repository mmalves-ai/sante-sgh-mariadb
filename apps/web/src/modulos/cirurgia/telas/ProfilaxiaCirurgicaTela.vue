<script setup lang="ts">
// Auditoria da profilaxia antimicrobiana cirúrgica (C2-012, 04-CC linha 106; Anvisa, prevenção de infecção do sítio
// cirúrgico). Painel da comissão de controle de infecção hospitalar (CCIH): as cirurgias do período por paciente, com
// a auditoria vigente (droga, dose, via, momento antes da incisão, repique e suspensão em até 24 horas) e os
// indicadores; um clique audita a cirurgia (ou todas as ainda sem auditoria). A auditoria lê a administração checada
// no prontuário e a incisão do registro do ato no bloco; a anterior fica no histórico. Na aba do protocolo, o
// cadastro por procedimento ou grupo, com a validação na hora (a mesma regra do servidor: até 60 minutos antes da
// incisão, 120 para vancomicina e fluoroquinolonas). Protocolo desativado fica na lista; nada é apagado.
import { conferirProtocoloProfilaxia } from '@sgh/dominio-cirurgia';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  ativarProtocoloProfilaxia,
  auditarProfilaxiaDoAto,
  type AuditoriaProfilaxia,
  incluirProtocoloProfilaxia,
  lerPainelProfilaxia,
  lerProtocolosProfilaxia,
} from '../api-profilaxia-cirurgica.js';
import ErroCirurgia from '../componentes/ErroCirurgia.vue';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Profilaxia antimicrobiana cirúrgica',
      abaPainel: 'Painel da CCIH',
      abaProtocolos: 'Protocolos',
      de: 'De',
      ate: 'Até',
      filtro: 'Mostrar',
      filtros: {
        todas: 'Todas',
        sem: 'Sem auditoria',
        nao_conforme: 'Não conformes',
        pendente: 'Em curso',
      },
      indicadores:
        '{cirurgias} cirurgia(s) · {auditadas} auditada(s) · {conformes} conforme(s) · {nao} não conforme(s) · conformidade {pct}',
      semPct: '—',
      nenhuma: 'Nenhuma cirurgia com incisão no período.',
      auditar: 'Auditar',
      reauditar: 'Auditar de novo',
      auditarTodas: 'Auditar as sem auditoria ({n})',
      justificativa: 'Parecer da comissão (opcional)',
      situacoes: {
        conforme: 'Conforme',
        nao_conforme: 'Não conforme',
        nao_avaliavel: 'Não avaliável',
        pendente: 'Em curso',
        sem: 'Sem auditoria',
      },
      criterios: {
        drogaAdequada: 'Droga',
        doseAdequada: 'Dose',
        viaAdequada: 'Via',
        momentoAdequado: 'Momento',
        repiqueAdequado: 'Repique',
        duracaoAdequada: 'Até 24 h',
      },
      sim: 'adequado',
      nao: 'inadequado',
      semDado: 'sem dado',
      paciente: '{nome} · prontuário {pront} · {proc}',
      incisao: 'Incisão {h}',
      motivos: {
        'sem-incisao': 'sem a hora da incisão no registro do ato',
        'sem-protocolo': 'sem protocolo para o procedimento',
        'sem-dose': 'nenhuma dose checada no prontuário',
        'droga-fora-do-protocolo': 'antimicrobiano fora do protocolo',
        'dose-fora-da-janela': 'primeira dose fora da janela antes da incisão',
        'dose-depois-da-incisao': 'primeira dose depois da incisão',
        'dose-diferente': 'dose diferente da do protocolo',
        'dose-sem-comparacao': 'dose sem unidade comparável',
        'via-diferente': 'via diferente da do protocolo',
        'repique-faltando': 'repique faltando',
        'profilaxia-prolongada': 'profilaxia além do limite',
        'duracao-em-curso': 'prescrição ainda aberta (reaudite depois)',
        'sem-marca-profilatica':
          'antimicrobiano sem ficha profilática (confira se é profilaxia ou tratamento)',
      },
      resultado: 'Auditoria gravada: {s}. {m}',
      procedimento: 'Procedimento',
      grupo: 'Grupo de procedimentos (no lugar do procedimento)',
      classe: 'Classe de contaminação (vazio: todas)',
      antimicrobiano: 'Antimicrobiano',
      dose: 'Dose',
      porKg: 'Dose por quilo de peso',
      unidade: 'Unidade',
      via: 'Via',
      janela: 'Minutos antes da incisão (máximo)',
      dicaJanela: 'Padrão: até {n} minutos antes da incisão.',
      repique: 'Repique a cada (horas)',
      duracao: 'Duração máxima (horas)',
      alergia: 'Alternativa para alérgico',
      ordem: 'Ordem de preferência',
      vigencia: 'Vigente desde',
      incluir: 'Incluir protocolo',
      escolha: 'Escolha',
      todas: 'Todas',
      nenhum: 'Nenhum',
      nenhumProtocolo: 'Nenhum protocolo: sem protocolo a auditoria não é avaliável.',
      resumoProtocolo: '{alvo} · {am} {dose} {un}{kg} · até {jan} min antes{rep} · {dur} h{alt}',
      porKgCurto: '/kg',
      repCurto: ' · repique {h} h',
      altCurto: ' · alternativa para alérgico',
      desativar: 'Desativar',
      reativar: 'Reativar',
      inativo: 'inativo',
      gravado: 'Gravado.',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeRegistrar = computed(() => permissoes.value.has('qualidade.ccih.registrar'));
const aba = ref<'painel' | 'protocolos'>('painel');

const hoje = new Date();
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const de = ref<string | null>(iso(new Date(hoje.getTime() - 7 * 86_400_000)));
const ate = ref<string | null>(iso(hoje));
const filtro = ref<'todas' | 'sem' | 'nao_conforme' | 'pendente'>('todas');
const justificativa = ref('');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

const painel = useQuery({
  queryKey: computed(() => ['cirurgia', 'profilaxia', 'painel', de.value, ate.value]),
  queryFn: () => lerPainelProfilaxia(de.value!, ate.value!),
  enabled: computed(() => !!de.value && !!ate.value && de.value <= ate.value!),
});
const protocolos = useQuery({
  queryKey: ['cirurgia', 'profilaxia', 'protocolos'],
  queryFn: lerProtocolosProfilaxia,
});
const p = computed(() => painel.data.value);
const pr = computed(() => protocolos.data.value);

const situacaoDe = (a: AuditoriaProfilaxia | null) => (a ? a.situacao : 'sem');
const cirurgias = computed(() =>
  (p.value?.cirurgias ?? []).filter(
    (c) => filtro.value === 'todas' || situacaoDe(c.auditoria) === filtro.value,
  ),
);
const semAuditoria = computed(() => (p.value?.cirurgias ?? []).filter((c) => !c.auditoria));
const CRITERIOS = [
  'drogaAdequada',
  'doseAdequada',
  'viaAdequada',
  'momentoAdequado',
  'repiqueAdequado',
  'duracaoAdequada',
] as const;
const valorCriterio = (v: boolean | null) => (v === null ? t('semDado') : v ? t('sim') : t('nao'));
const hora = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const opcoesFiltro = computed(() =>
  (['todas', 'sem', 'nao_conforme', 'pendente'] as const).map((f) => ({
    valor: f,
    rotulo: t(`filtros.${f}`),
  })),
);

async function rodar(fn: () => Promise<unknown>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    await cliente.invalidateQueries({ queryKey: ['cirurgia', 'profilaxia'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const auditar = (ato: number) =>
  rodar(async () => {
    const r = await auditarProfilaxiaDoAto(ato, justificativa.value.trim() || null);
    mensagem.value = t('resultado', {
      s: t(`situacoes.${r.situacao}`),
      m: r.motivos.map((x) => t(`motivos.${x}`)).join('; '),
    });
    justificativa.value = '';
  });

const auditarTodas = () =>
  rodar(async () => {
    for (const c of semAuditoria.value) await auditarProfilaxiaDoAto(c.ato, null);
    mensagem.value = t('gravado');
  });

// ── Protocolo ──
const vazio = () => ({
  procedimento: '',
  grupo: '',
  classe: '',
  antimicrobiano: '',
  dose: '',
  porKg: false,
  unidade: '',
  via: '',
  janela: '',
  repique: '',
  duracao: '24',
  alergia: false,
  ordem: '1',
  vigencia: iso(hoje) as string | null,
});
const n = ref(vazio());
const idOuNull = (v: string) => (v ? Number(v) : null);
const numOuNull = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')));
const janelaLonga = computed(
  () =>
    pr.value?.opcoes.antimicrobianos.find((a) => String(a.id) === n.value.antimicrobiano)?.janelaLonga ??
    false,
);
const problemas = computed(() =>
  n.value.antimicrobiano || n.value.procedimento || n.value.grupo
    ? conferirProtocoloProfilaxia(
        {
          procedimento: idOuNull(n.value.procedimento),
          grupo: idOuNull(n.value.grupo),
          antimicrobiano: idOuNull(n.value.antimicrobiano),
          dose: numOuNull(n.value.dose),
          dosePorKg: n.value.porKg,
          unidade: idOuNull(n.value.unidade),
          antesMinimo: null,
          antesMaximo: numOuNull(n.value.janela),
          intervaloRepiqueHoras: numOuNull(n.value.repique),
          duracaoMaximaHoras: numOuNull(n.value.duracao),
          vigenciaInicio: n.value.vigencia,
          vigenciaFim: null,
        },
        janelaLonga.value,
      )
    : [],
);
const comVazio = (l: { id: number; rotulo: string }[] | undefined, vazioRotulo: string) => [
  { valor: '', rotulo: vazioRotulo },
  ...(l ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
];
const opcoesProc = computed(() => comVazio(pr.value?.opcoes.procedimentos, t('nenhum')));
const opcoesGrupo = computed(() => comVazio(pr.value?.opcoes.grupos, t('nenhum')));
const opcoesClasse = computed(() => comVazio(pr.value?.opcoes.classes, t('todas')));
const opcoesAm = computed(() => comVazio(pr.value?.opcoes.antimicrobianos, t('escolha')));
const opcoesUnidade = computed(() => comVazio(pr.value?.opcoes.unidades, t('escolha')));
const opcoesVia = computed(() => comVazio(pr.value?.opcoes.vias, t('nenhum')));

const gravarProtocolo = () =>
  rodar(async () => {
    await incluirProtocoloProfilaxia({
      procedimento: idOuNull(n.value.procedimento),
      grupo: idOuNull(n.value.grupo),
      classeContaminacao: idOuNull(n.value.classe),
      antimicrobiano: Number(n.value.antimicrobiano),
      dose: numOuNull(n.value.dose)!,
      dosePorKg: n.value.porKg,
      unidade: Number(n.value.unidade),
      via: idOuNull(n.value.via),
      antesMaximo: numOuNull(n.value.janela),
      intervaloRepiqueHoras: numOuNull(n.value.repique),
      duracaoMaximaHoras: numOuNull(n.value.duracao),
      alternativaAlergia: n.value.alergia,
      ordem: Number(n.value.ordem) || 1,
      vigenciaInicio: n.value.vigencia!,
    });
    n.value = vazio();
    mensagem.value = t('gravado');
  });

const alternar = (id: number, versao: number, ativo: boolean) =>
  rodar(async () => {
    await ativarProtocoloProfilaxia(id, versao, ativo);
    mensagem.value = t('gravado');
  });
</script>

<template>
  <main class="tela" data-testid="profilaxia-cirurgica">
    <h1>{{ t('titulo') }}</h1>
    <nav class="abas" role="tablist">
      <SanteBotao
        :variante="aba === 'painel' ? 'primario' : 'texto'"
        :rotulo="t('abaPainel')"
        role="tab"
        :aria-selected="aba === 'painel'"
        data-testid="profilaxia-aba-painel"
        @acionar="aba = 'painel'"
      />
      <SanteBotao
        :variante="aba === 'protocolos' ? 'primario' : 'texto'"
        :rotulo="t('abaProtocolos')"
        role="tab"
        :aria-selected="aba === 'protocolos'"
        data-testid="profilaxia-aba-protocolos"
        @acionar="aba = 'protocolos'"
      />
    </nav>

    <section v-if="aba === 'painel'" class="painel" aria-labelledby="painel-titulo">
      <h2 id="painel-titulo">{{ t('abaPainel') }}</h2>
      <div class="filtros">
        <SanteData v-model="de" :rotulo="t('de')" editavel data-testid="profilaxia-de" />
        <SanteData v-model="ate" :rotulo="t('ate')" editavel data-testid="profilaxia-ate" />
        <SanteSelecao
          v-model="filtro"
          :rotulo="t('filtro')"
          :opcoes="opcoesFiltro"
          data-testid="profilaxia-filtro"
        />
      </div>
      <ErroCirurgia v-if="painel.isError.value" :erro="painel.error.value" />
      <template v-if="p">
        <p data-testid="profilaxia-indicadores">
          {{
            t('indicadores', {
              cirurgias: p.indicadores.cirurgias,
              auditadas: p.indicadores.auditadas,
              conformes: p.indicadores.conformes,
              nao: p.indicadores.naoConformes,
              pct:
                p.indicadores.percentualConforme === null
                  ? t('semPct')
                  : `${p.indicadores.percentualConforme}%`,
            })
          }}
        </p>
        <div v-if="podeRegistrar" class="formulario">
          <SanteCampoTexto
            v-model="justificativa"
            :rotulo="t('justificativa')"
            :max-bytes="4000"
            data-testid="profilaxia-justificativa"
          />
          <SanteBotao
            v-if="semAuditoria.length"
            :rotulo="t('auditarTodas', { n: semAuditoria.length })"
            :desabilitado="ocupado"
            data-testid="profilaxia-auditar-todas"
            @acionar="auditarTodas"
          />
        </div>
        <p v-if="!cirurgias.length">{{ t('nenhuma') }}</p>
        <ul v-else class="lista" data-testid="profilaxia-cirurgias">
          <li
            v-for="c in cirurgias"
            :key="c.ato"
            :data-testid="`profilaxia-ato-${c.ato}`"
            :data-situacao="situacaoDe(c.auditoria)"
          >
            <strong>{{ c.numero }}</strong> ·
            {{ t('paciente', { nome: c.paciente, pront: c.prontuario ?? '—', proc: c.procedimento ?? '—' }) }}
            ·
            {{ t('incisao', { h: hora(c.incisao) }) }}
            <div>
              <span class="selo" :data-testid="`profilaxia-situacao-${c.ato}`">{{
                t(`situacoes.${situacaoDe(c.auditoria)}`)
              }}</span>
              <template v-if="c.auditoria">
                <span v-if="c.auditoria.antimicrobiano"> · {{ c.auditoria.antimicrobiano }}</span>
                <span v-for="k in CRITERIOS" :key="k" :data-testid="`profilaxia-${k}-${c.ato}`">
                  · {{ t(`criterios.${k}`) }}: {{ valorCriterio(c.auditoria[k]) }}</span
                >
                <span v-if="c.auditoria.justificativa"> · {{ c.auditoria.justificativa }}</span>
              </template>
            </div>
            <SanteBotao
              v-if="podeRegistrar"
              variante="texto"
              :rotulo="c.auditoria ? t('reauditar') : t('auditar')"
              :desabilitado="ocupado"
              :data-testid="`profilaxia-auditar-${c.ato}`"
              @acionar="auditar(c.ato)"
            />
          </li>
        </ul>
      </template>
    </section>

    <section v-else class="painel" aria-labelledby="protocolos-titulo">
      <h2 id="protocolos-titulo">{{ t('abaProtocolos') }}</h2>
      <ErroCirurgia v-if="protocolos.isError.value" :erro="protocolos.error.value" />
      <template v-if="pr">
        <p v-if="!pr.protocolos.length">{{ t('nenhumProtocolo') }}</p>
        <ul v-else data-testid="profilaxia-protocolos">
          <li
            v-for="x in pr.protocolos"
            :key="x.id"
            :data-testid="`profilaxia-protocolo-${x.id}`"
            :data-ativo="x.ativo"
          >
            {{
              t('resumoProtocolo', {
                alvo: x.procedimentoDescricao ?? x.grupoDescricao ?? '—',
                am: x.antimicrobianoDescricao,
                dose: x.dose,
                un: x.unidadeSigla,
                kg: x.dosePorKg ? t('porKgCurto') : '',
                jan: x.janelaMaxima,
                rep: x.intervaloRepiqueHoras ? t('repCurto', { h: x.intervaloRepiqueHoras }) : '',
                dur: x.duracaoMaximaHoras ?? 24,
                alt: x.alternativaAlergia ? t('altCurto') : '',
              })
            }}
            <span v-if="!x.ativo"> · {{ t('inativo') }}</span>
            <SanteBotao
              v-if="podeRegistrar"
              variante="texto"
              :rotulo="x.ativo ? t('desativar') : t('reativar')"
              :data-testid="`profilaxia-protocolo-alternar-${x.id}`"
              @acionar="alternar(x.id, x.versao, !x.ativo)"
            />
          </li>
        </ul>
        <form
          v-if="podeRegistrar"
          class="formulario"
          data-testid="profilaxia-protocolo-form"
          @submit.prevent="gravarProtocolo"
        >
          <SanteSelecao
            v-model="n.procedimento"
            :rotulo="t('procedimento')"
            :opcoes="opcoesProc"
            data-testid="protocolo-procedimento"
          />
          <SanteSelecao
            v-model="n.grupo"
            :rotulo="t('grupo')"
            :opcoes="opcoesGrupo"
            data-testid="protocolo-grupo"
          />
          <SanteSelecao
            v-model="n.classe"
            :rotulo="t('classe')"
            :opcoes="opcoesClasse"
            data-testid="protocolo-classe"
          />
          <SanteSelecao
            v-model="n.antimicrobiano"
            :rotulo="t('antimicrobiano')"
            :opcoes="opcoesAm"
            data-testid="protocolo-antimicrobiano"
          />
          <SanteCampoTexto
            v-model="n.dose"
            :rotulo="t('dose')"
            :max-bytes="12"
            data-testid="protocolo-dose"
          />
          <label
            ><input v-model="n.porKg" type="checkbox" data-testid="protocolo-porkg" /> {{ t('porKg') }}</label
          >
          <SanteSelecao
            v-model="n.unidade"
            :rotulo="t('unidade')"
            :opcoes="opcoesUnidade"
            data-testid="protocolo-unidade"
          />
          <SanteSelecao v-model="n.via" :rotulo="t('via')" :opcoes="opcoesVia" data-testid="protocolo-via" />
          <SanteCampoTexto
            v-model="n.janela"
            :rotulo="t('janela')"
            :max-bytes="4"
            data-testid="protocolo-janela"
          />
          <small data-testid="protocolo-dica-janela">{{
            t('dicaJanela', { n: janelaLonga ? 120 : 60 })
          }}</small>
          <SanteCampoTexto
            v-model="n.repique"
            :rotulo="t('repique')"
            :max-bytes="5"
            data-testid="protocolo-repique"
          />
          <SanteCampoTexto
            v-model="n.duracao"
            :rotulo="t('duracao')"
            :max-bytes="3"
            data-testid="protocolo-duracao"
          />
          <label
            ><input v-model="n.alergia" type="checkbox" data-testid="protocolo-alergia" />
            {{ t('alergia') }}</label
          >
          <SanteCampoTexto
            v-model="n.ordem"
            :rotulo="t('ordem')"
            :max-bytes="2"
            data-testid="protocolo-ordem"
          />
          <SanteData v-model="n.vigencia" :rotulo="t('vigencia')" editavel data-testid="protocolo-vigencia" />
          <small v-for="x in problemas" :key="x.campo" class="erro-campo" data-testid="protocolo-problema">{{
            x.mensagem
          }}</small>
          <SanteBotao
            :rotulo="t('incluir')"
            :desabilitado="!n.antimicrobiano || problemas.length > 0 || ocupado"
            data-testid="protocolo-gravar"
            @acionar="gravarProtocolo"
          />
        </form>
      </template>
    </section>

    <p v-if="mensagem" role="status" data-testid="profilaxia-mensagem">{{ mensagem }}</p>
    <ErroCirurgia v-if="erro" :erro="erro" />
  </main>
</template>

<style scoped>
.abas,
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.lista li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.selo {
  font-weight: 600;
}
.erro-campo {
  color: var(--sgh-texto-secundario);
}
</style>
