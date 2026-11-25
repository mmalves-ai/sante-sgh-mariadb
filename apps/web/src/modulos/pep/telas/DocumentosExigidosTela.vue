<script setup lang="ts">
// Documentos exigidos por diagnóstico, idade ou setor (C2-028, 03-PEP L132). Aba "Pendências": a lista do
// profissional, por paciente, com os atendimentos abertos em que falta documento exigido pela regra do hospital; a
// vencida e a que bloqueia o passo seguinte vêm primeiro e em destaque, com o motivo (o CID, a idade, o setor) e o
// prazo; um clique abre o prontuário do paciente. Aba "Regras" (administração do PEP): o cadastro da regra (documento,
// setor, sexo, tipo de atendimento, faixa etária em anos, CID-10 por código ou categoria, momento, exigência, prazo,
// intervalo do periódico e vigência), com a validação na hora pela mesma regra do servidor; alterar e desativar
// seguem a versão lida, e a regra desativada fica na lista (nada é apagado).
import {
  EXIGENCIAS_OBRIGATORIEDADE,
  MOMENTOS_OBRIGATORIEDADE,
  TIPOS_ATENDIMENTO_OBRIGATORIEDADE,
  validarRegraObrigatoriedade,
} from '@sgh/dominio-pep';
import { SanteBotao, SanteCampoTexto, SanteData, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { usarSessao } from '../../../casca/sessao/sessao.js';
import {
  alterarRegraDocumento,
  ativarRegraDocumento,
  incluirRegraDocumento,
  lerPendenciasDocumentos,
  lerRegrasDocumentos,
  type PendenciaDocumento,
  type RegraDocumentoExigido,
  type RegraDocumentoPedido,
} from '../api-documentos-exigidos.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Documentos exigidos',
      abaPendencias: 'Pendências',
      abaRegras: 'Regras',
      setor: 'Setor',
      todosSetores: 'Todos os setores',
      soVencidas: 'Só as vencidas',
      totais:
        '{atendimentos} atendimento(s) · {pendencias} documento(s) faltando · {vencidas} vencido(s) · {bloqueantes} bloqueante(s)',
      semRegras: 'Nenhuma regra ativa: cadastre na aba Regras quais documentos o hospital exige.',
      nenhuma: 'Nenhum documento exigido faltando.',
      paciente: '{nome} · prontuário {pront} · atendimento {num}',
      abrirProntuario: 'Abrir prontuário',
      prazo: 'prazo {h}',
      semPrazo: 'sem prazo',
      vencida: 'Vencido',
      bloqueia: 'Bloqueia',
      alerta: 'Alerta',
      momentos: {
        admissao: 'Na admissão',
        durante_atendimento: 'Durante o atendimento',
        periodico: 'Periódico',
        prescricao: 'Com a prescrição',
        alta: 'Na alta',
        fechamento_atendimento: 'No fechamento do atendimento',
      },
      exigencias: { bloquear: 'Bloqueia o passo seguinte', alertar: 'Só alerta' },
      tipos: {
        todos: 'Todos',
        ambulatorial: 'Ambulatorial',
        urgencia: 'Urgência',
        internacao: 'Internação',
        externo: 'Externo',
        domiciliar: 'Domiciliar',
      },
      nenhumaRegra: 'Nenhuma regra cadastrada.',
      resumoRegra: '{doc} · {momento} · {exig}{setor}{idade}{cids}',
      resumoSetor: ' · setor {s}',
      resumoIdade: ' · de {min} a {max} anos',
      resumoCids: ' · CID {c}',
      qualquer: 'qualquer',
      inativa: 'inativa',
      editar: 'Editar',
      desativar: 'Desativar',
      reativar: 'Reativar',
      novaRegra: 'Nova regra',
      alterandoRegra: 'Alterando a regra {id}',
      modelo: 'Documento exigido',
      escolha: 'Escolha',
      todos: 'Todos',
      sexo: 'Sexo',
      tipoAtendimento: 'Tipo de atendimento',
      idadeMinima: 'Idade mínima (anos)',
      idadeMaxima: 'Idade máxima (anos)',
      cids: 'CID-10 (códigos ou categorias, separados por vírgula; vazio: qualquer diagnóstico)',
      momento: 'Momento',
      exigencia: 'Exigência',
      prazoHoras: 'Prazo para preencher (horas)',
      intervalo: 'Intervalo do periódico (dias)',
      vigenciaInicio: 'Vigente desde',
      vigenciaFim: 'Vigente até',
      todosEstabelecimentos: 'Vale para todos os estabelecimentos',
      numeroInvalido: 'Informe um número em {campo}.',
      incluir: 'Incluir regra',
      gravarAlteracao: 'Gravar alteração',
      cancelar: 'Cancelar',
      gravado: 'Gravado.',
    },
  },
});

const cliente = useQueryClient();
const { permissoes } = usarSessao();
const podeRegras = computed(() => permissoes.value.has('pep.admin.ler'));
const podeEditar = computed(() => permissoes.value.has('pep.admin.editar'));
const aba = ref<'pendencias' | 'regras'>('pendencias');
const mensagem = ref<string | null>(null);
const erro = ref<unknown>(null);
const ocupado = ref(false);

// ── Pendências ──
const setor = ref<string>('');
const vencidas = ref(false);
const pendencias = useQuery({
  queryKey: computed(() => ['pep', 'documentos-exigidos', 'pendencias', setor.value, vencidas.value]),
  queryFn: () => lerPendenciasDocumentos(setor.value ? Number(setor.value) : null, vencidas.value),
});
const dados = computed(() => pendencias.data.value);
// Os setores vistos na lista ficam no filtro mesmo depois de filtrar (o filtro é do servidor).
const setoresVistos = ref(new Map<number, string>());
watch(
  () => dados.value?.itens,
  (itens) => {
    for (const a of itens ?? [])
      if (a.setor !== null) setoresVistos.value.set(a.setor, a.setorNome ?? String(a.setor));
  },
  { immediate: true },
);
const opcoesSetor = computed(() => [
  { valor: '', rotulo: t('todosSetores') },
  ...[...setoresVistos.value].map(([id, nome]) => ({ valor: String(id), rotulo: nome })),
]);
const peso = (p: PendenciaDocumento) => (p.vencida ? 0 : 2) + (p.exigencia === 'bloquear' ? 0 : 1);
const ordenadas = (l: readonly PendenciaDocumento[]) => [...l].sort((a, b) => peso(a) - peso(b));
// O paciente com vencida bloqueante sobe na lista.
const itens = computed(() =>
  [...(dados.value?.itens ?? [])].sort(
    (a, b) =>
      Math.min(...a.pendencias.map(peso)) - Math.min(...b.pendencias.map(peso)) ||
      a.pacienteNome.localeCompare(b.pacienteNome),
  ),
);
const hora = (s: string | null) =>
  s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';

// ── Regras ──
const regras = useQuery({
  queryKey: ['pep', 'documentos-exigidos', 'regras'],
  queryFn: lerRegrasDocumentos,
  enabled: podeRegras,
});
const rg = computed(() => regras.data.value);
const ANO = 365.25;
const vazio = () => ({
  modelo: '',
  setor: '',
  sexo: '',
  tipoAtendimento: 'todos' as RegraDocumentoExigido['tipoAtendimento'],
  idadeMinima: '',
  idadeMaxima: '',
  cids: '',
  momento: 'admissao' as RegraDocumentoExigido['momento'],
  exigencia: 'alertar' as RegraDocumentoExigido['exigencia'],
  prazoHoras: '',
  intervalo: '',
  vigenciaInicio: new Date().toISOString().slice(0, 10) as string | null,
  vigenciaFim: null as string | null,
  todosEstabelecimentos: false,
});
const n = ref(vazio());
const editando = ref<{ id: number; versao: number } | null>(null);

const numero = (v: string): number | null | undefined => {
  const s = v.trim().replace(',', '.');
  if (s === '') return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : undefined;
};
const anosParaDias = (v: number | null | undefined) =>
  v === null || v === undefined ? null : Math.round(v * ANO);
const listaCids = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);

const naoNumericos = computed(() =>
  (
    [
      ['idadeMinima', n.value.idadeMinima],
      ['idadeMaxima', n.value.idadeMaxima],
      ['prazoHoras', n.value.prazoHoras],
      ['intervalo', n.value.intervalo],
    ] as const
  )
    .filter(([, v]) => numero(v) === undefined)
    .map(([campo]) => ({ codigo: `numero-${campo}`, mensagem: t('numeroInvalido', { campo: t(campo) }) })),
);
const pedido = computed((): RegraDocumentoPedido => {
  const prazo = numero(n.value.prazoHoras);
  return {
    modelo: Number(n.value.modelo),
    setor: n.value.setor ? Number(n.value.setor) : null,
    sexo: n.value.sexo ? Number(n.value.sexo) : null,
    tipoAtendimento: n.value.tipoAtendimento,
    idadeMinimaDias: anosParaDias(numero(n.value.idadeMinima)),
    idadeMaximaDias: anosParaDias(numero(n.value.idadeMaxima)),
    cids: listaCids(n.value.cids),
    momento: n.value.momento,
    exigencia: n.value.exigencia,
    prazoMinutos: prazo === null || prazo === undefined ? null : Math.round(prazo * 60),
    intervaloDias: numero(n.value.intervalo) ?? null,
    vigenciaInicio: n.value.vigenciaInicio ?? '',
    vigenciaFim: n.value.vigenciaFim || null,
    todosEstabelecimentos: n.value.todosEstabelecimentos,
  };
});
const problemas = computed(() => [...naoNumericos.value, ...validarRegraObrigatoriedade(pedido.value)]);

const comVazio = (l: { id: number; rotulo: string }[] | undefined, vazioRotulo: string) => [
  { valor: '', rotulo: vazioRotulo },
  ...(l ?? []).map((x) => ({ valor: String(x.id), rotulo: x.rotulo })),
];
const opcoesModelo = computed(() => comVazio(rg.value?.opcoes.modelos, t('escolha')));
const opcoesSetorRegra = computed(() => comVazio(rg.value?.opcoes.setores, t('todos')));
const opcoesSexo = computed(() => comVazio(rg.value?.opcoes.sexos, t('todos')));
const opcoesTipo = computed(() =>
  TIPOS_ATENDIMENTO_OBRIGATORIEDADE.map((x) => ({ valor: x, rotulo: t(`tipos.${x}`) })),
);
const opcoesMomento = computed(() =>
  MOMENTOS_OBRIGATORIEDADE.map((x) => ({ valor: x, rotulo: t(`momentos.${x}`) })),
);
const opcoesExigencia = computed(() =>
  EXIGENCIAS_OBRIGATORIEDADE.map((x) => ({ valor: x, rotulo: t(`exigencias.${x}`) })),
);

const anos = (d: number | null) => (d === null ? '' : String(Math.round((d / ANO) * 10) / 10));
const resumo = (r: RegraDocumentoExigido) =>
  t('resumoRegra', {
    doc: r.titulo,
    momento: t(`momentos.${r.momento}`),
    exig: t(`exigencias.${r.exigencia}`),
    setor: r.setorNome ? t('resumoSetor', { s: r.setorNome }) : '',
    idade:
      r.idadeMinimaDias !== null || r.idadeMaximaDias !== null
        ? t('resumoIdade', {
            min: anos(r.idadeMinimaDias) || '0',
            max: anos(r.idadeMaximaDias) || t('qualquer'),
          })
        : '',
    cids: r.cids.length ? t('resumoCids', { c: r.cids.join(', ') }) : '',
  });

function editar(r: RegraDocumentoExigido): void {
  editando.value = { id: r.id, versao: r.versao };
  n.value = {
    modelo: String(r.modelo),
    setor: r.setor === null ? '' : String(r.setor),
    sexo: r.sexo === null ? '' : String(r.sexo),
    tipoAtendimento: r.tipoAtendimento,
    idadeMinima: anos(r.idadeMinimaDias),
    idadeMaxima: anos(r.idadeMaximaDias),
    cids: r.cids.join(', '),
    momento: r.momento,
    exigencia: r.exigencia,
    prazoHoras: r.prazoMinutos === null ? '' : String(r.prazoMinutos / 60),
    intervalo: r.intervaloDias === null ? '' : String(r.intervaloDias),
    vigenciaInicio: r.vigenciaInicio,
    vigenciaFim: r.vigenciaFim,
    todosEstabelecimentos: r.todosEstabelecimentos,
  };
}
function cancelar(): void {
  editando.value = null;
  n.value = vazio();
}

async function rodar(fn: () => Promise<unknown>): Promise<void> {
  ocupado.value = true;
  erro.value = null;
  mensagem.value = null;
  try {
    await fn();
    mensagem.value = t('gravado');
    await cliente.invalidateQueries({ queryKey: ['pep', 'documentos-exigidos'] });
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

const gravar = () =>
  rodar(async () => {
    if (editando.value) await alterarRegraDocumento(editando.value.id, editando.value.versao, pedido.value);
    else await incluirRegraDocumento(pedido.value);
    cancelar();
  });
const alternar = (r: RegraDocumentoExigido) => rodar(() => ativarRegraDocumento(r.id, r.versao, !r.ativo));
</script>

<template>
  <main class="tela" data-testid="documentos-exigidos">
    <h1>{{ t('titulo') }}</h1>
    <nav class="abas" role="tablist">
      <SanteBotao
        :variante="aba === 'pendencias' ? 'primario' : 'texto'"
        :rotulo="t('abaPendencias')"
        role="tab"
        :aria-selected="aba === 'pendencias'"
        data-testid="docexig-aba-pendencias"
        @acionar="aba = 'pendencias'"
      />
      <SanteBotao
        v-if="podeRegras"
        :variante="aba === 'regras' ? 'primario' : 'texto'"
        :rotulo="t('abaRegras')"
        role="tab"
        :aria-selected="aba === 'regras'"
        data-testid="docexig-aba-regras"
        @acionar="aba = 'regras'"
      />
    </nav>

    <section v-if="aba === 'pendencias'" class="painel" aria-labelledby="docexig-pend-titulo">
      <h2 id="docexig-pend-titulo">{{ t('abaPendencias') }}</h2>
      <div class="filtros">
        <SanteSelecao
          v-model="setor"
          :rotulo="t('setor')"
          :opcoes="opcoesSetor"
          data-testid="docexig-setor"
        />
        <label
          ><input v-model="vencidas" type="checkbox" data-testid="docexig-vencidas" />
          {{ t('soVencidas') }}</label
        >
      </div>
      <MensagemErro v-if="pendencias.isError.value" :erro="pendencias.error.value" />
      <template v-if="dados">
        <p data-testid="docexig-totais">{{ t('totais', dados.totais) }}</p>
        <p v-if="!dados.regrasAtivas" data-testid="docexig-sem-regras">{{ t('semRegras') }}</p>
        <p v-else-if="!itens.length">{{ t('nenhuma') }}</p>
        <ul v-else class="lista" data-testid="docexig-lista">
          <li v-for="a in itens" :key="a.atendimento" :data-testid="`docexig-atendimento-${a.atendimento}`">
            <strong>{{
              t('paciente', { nome: a.pacienteNome, pront: a.prontuario ?? '—', num: a.numero })
            }}</strong>
            <span v-if="a.setorNome"> · {{ a.setorNome }}</span>
            <RouterLink :to="`/pep/prontuario/${a.paciente}`" :data-testid="`docexig-abrir-${a.atendimento}`">
              {{ t('abrirProntuario') }}</RouterLink
            >
            <ul>
              <li
                v-for="p in ordenadas(a.pendencias)"
                :key="`${p.regra}-${p.exigidoDesde}`"
                :class="{ vencida: p.vencida, bloqueia: p.exigencia === 'bloquear' }"
                :data-testid="`docexig-pendencia-${a.atendimento}-${p.regra}`"
                :data-vencida="p.vencida"
                :data-exigencia="p.exigencia"
              >
                <span class="selo">{{ p.exigencia === 'bloquear' ? t('bloqueia') : t('alerta') }}</span>
                <span v-if="p.vencida" class="selo"> · {{ t('vencida') }}</span>
                · {{ p.titulo }} · {{ t(`momentos.${p.momento}`) }} ·
                {{ p.prazo ? t('prazo', { h: hora(p.prazo) }) : t('semPrazo') }} · {{ p.motivo }}
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </section>

    <section v-else class="painel" aria-labelledby="docexig-regras-titulo">
      <h2 id="docexig-regras-titulo">{{ t('abaRegras') }}</h2>
      <MensagemErro v-if="regras.isError.value" :erro="regras.error.value" />
      <template v-if="rg">
        <p v-if="!rg.regras.length">{{ t('nenhumaRegra') }}</p>
        <ul v-else class="lista" data-testid="docexig-regras">
          <li v-for="r in rg.regras" :key="r.id" :data-testid="`docexig-regra-${r.id}`" :data-ativo="r.ativo">
            {{ resumo(r) }}<span v-if="!r.ativo"> · {{ t('inativa') }}</span>
            <template v-if="podeEditar">
              <SanteBotao
                variante="texto"
                :rotulo="t('editar')"
                :data-testid="`docexig-regra-editar-${r.id}`"
                @acionar="editar(r)"
              />
              <SanteBotao
                variante="texto"
                :rotulo="r.ativo ? t('desativar') : t('reativar')"
                :desabilitado="ocupado"
                :data-testid="`docexig-regra-alternar-${r.id}`"
                @acionar="alternar(r)"
              />
            </template>
          </li>
        </ul>
        <form v-if="podeEditar" class="formulario" data-testid="docexig-form" @submit.prevent="gravar">
          <h3>{{ editando ? t('alterandoRegra', { id: editando.id }) : t('novaRegra') }}</h3>
          <SanteSelecao
            v-model="n.modelo"
            :rotulo="t('modelo')"
            :opcoes="opcoesModelo"
            data-testid="docexig-modelo"
          />
          <SanteSelecao
            v-model="n.momento"
            :rotulo="t('momento')"
            :opcoes="opcoesMomento"
            data-testid="docexig-momento"
          />
          <SanteSelecao
            v-model="n.exigencia"
            :rotulo="t('exigencia')"
            :opcoes="opcoesExigencia"
            data-testid="docexig-exigencia"
          />
          <SanteCampoTexto
            v-model="n.cids"
            :rotulo="t('cids')"
            :max-bytes="2000"
            data-testid="docexig-cids"
          />
          <SanteSelecao
            v-model="n.setor"
            :rotulo="t('setor')"
            :opcoes="opcoesSetorRegra"
            data-testid="docexig-regra-setor"
          />
          <SanteSelecao
            v-model="n.sexo"
            :rotulo="t('sexo')"
            :opcoes="opcoesSexo"
            data-testid="docexig-sexo"
          />
          <SanteSelecao
            v-model="n.tipoAtendimento"
            :rotulo="t('tipoAtendimento')"
            :opcoes="opcoesTipo"
            data-testid="docexig-tipo"
          />
          <SanteCampoTexto
            v-model="n.idadeMinima"
            :rotulo="t('idadeMinima')"
            :max-bytes="5"
            data-testid="docexig-idade-min"
          />
          <SanteCampoTexto
            v-model="n.idadeMaxima"
            :rotulo="t('idadeMaxima')"
            :max-bytes="5"
            data-testid="docexig-idade-max"
          />
          <SanteCampoTexto
            v-model="n.prazoHoras"
            :rotulo="t('prazoHoras')"
            :max-bytes="6"
            data-testid="docexig-prazo"
          />
          <SanteCampoTexto
            v-model="n.intervalo"
            :rotulo="t('intervalo')"
            :max-bytes="4"
            data-testid="docexig-intervalo"
          />
          <SanteData
            v-model="n.vigenciaInicio"
            :rotulo="t('vigenciaInicio')"
            editavel
            data-testid="docexig-vigencia-inicio"
          />
          <SanteData
            v-model="n.vigenciaFim"
            :rotulo="t('vigenciaFim')"
            editavel
            data-testid="docexig-vigencia-fim"
          />
          <label
            ><input v-model="n.todosEstabelecimentos" type="checkbox" data-testid="docexig-todos-est" />
            {{ t('todosEstabelecimentos') }}</label
          >
          <small
            v-for="x in problemas"
            :key="x.codigo + x.mensagem"
            class="erro-campo"
            data-testid="docexig-problema"
            >{{ x.mensagem }}</small
          >
          <div class="abas">
            <SanteBotao
              :rotulo="editando ? t('gravarAlteracao') : t('incluir')"
              :desabilitado="!n.modelo || problemas.length > 0 || ocupado"
              data-testid="docexig-gravar"
              @acionar="gravar"
            />
            <SanteBotao
              v-if="editando"
              variante="texto"
              :rotulo="t('cancelar')"
              data-testid="docexig-cancelar"
              @acionar="cancelar"
            />
          </div>
        </form>
      </template>
    </section>

    <p v-if="mensagem" role="status" data-testid="docexig-mensagem">{{ mensagem }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
  </main>
</template>

<style scoped>
.abas,
.filtros {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.formulario {
  display: grid;
  gap: var(--sgh-espaco-2);
  max-width: 40rem;
}
.lista > li {
  padding: var(--sgh-espaco-1) 0;
  border-bottom: 1px solid var(--sgh-borda);
}
.selo {
  font-weight: 600;
}
.vencida,
.bloqueia {
  font-weight: 600;
}
.vencida {
  border-left: 3px solid var(--sgh-alerta);
  padding-left: var(--sgh-espaco-1);
}
.erro-campo {
  color: var(--sgh-texto-secundario);
}
</style>
