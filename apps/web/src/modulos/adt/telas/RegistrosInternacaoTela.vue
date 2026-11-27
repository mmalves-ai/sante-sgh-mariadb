<script setup lang="ts">
// Diagnósticos e acidente da internação (F3.4, 04-INT linha 67): `/internacao/:reg/registros`. Visão do paciente
// internado numa tela só: o histórico dos diagnósticos (entrada da admissão, principal vigente e substituídos,
// secundários, causa externa e retirados com o motivo), o registro de um novo com a regra conferida na hora e o acidente
// (o de trabalho pede quando e o empregador; a comunicação só vale para ele). Nada é apagado: a retirada é lógica.
import { conferirAcidente, ehCausaExterna, TIPOS_ACIDENTE } from '@sgh/dominio-internacao';
import { SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { ErroApi, mensagemDoErro } from '../../../casca/erros/problem-details.js';
import { dataBr } from '../../agenda/formato.js';
import { buscarCid, novaChave } from '../api-adt.js';
import {
  lerRegistros,
  registrarAcidente,
  registrarDiagnostico,
  retirarDiagnostico,
  type RegistrosInternacao,
} from '../api-registros.js';
import AvisoAdt from '../componentes/AvisoAdt.vue';
import ErroAdt from '../componentes/ErroAdt.vue';
import ResumoInternacao from '../componentes/ResumoInternacao.vue';
import { usarAdt } from '../usar-adt.js';
import { usarInternacao } from '../usar-internacao.js';

const props = defineProps<{ reg: string }>();
const { t } = useI18n();
const { pode, motivoDe } = usarAdt();
const podeDiagnostico = pode('internacao.registrarDiagnostico');
const podeRetirar = pode('internacao.retirarDiagnostico');
const podeAcidente = pode('internacao.registrarAcidente');
const aviso = motivoDe('internacao.registrarDiagnostico');
const reg = computed(() => Number(props.reg));
const { ficha } = usarInternacao(reg);

const registros = ref<RegistrosInternacao | null>(null);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const ocupado = ref(false);
// Sem o banco do cliente (fonte sintética) a API responde 503 com o tipo "indisponivel": a tela diz isso em vez da
// mensagem geral (a regra do acidente continua conferida na hora).
const semBanco = computed(
  () =>
    erro.value instanceof ErroApi &&
    erro.value.status === 503 &&
    mensagemDoErro(erro.value).tipo === 'indisponivel',
);
async function ler(): Promise<void> {
  try {
    registros.value = await lerRegistros(reg.value);
  } catch (x) {
    erro.value = x;
  }
}
onMounted(ler);

async function acao(fn: () => Promise<{ mensagem: string }>, depois: () => void): Promise<void> {
  erro.value = null;
  mensagem.value = null;
  ocupado.value = true;
  try {
    mensagem.value = (await fn()).mensagem;
    depois();
    await ler();
  } catch (x) {
    erro.value = x;
  } finally {
    ocupado.value = false;
  }
}

// ── Diagnóstico novo: busca do CID e o tipo sugerido pela regra (capítulo XX vira causa externa) ──
const termoCid = ref('');
const pedidoCid = ref('');
const cids = useQuery({
  queryKey: computed(() => ['adt', 'cid', pedidoCid.value]),
  queryFn: () => buscarCid(pedidoCid.value),
  enabled: computed(() => pedidoCid.value.length >= 2),
});
const cid = ref('');
const tipoDiag = ref('secundario');
const observacao = ref('');
const cidEscolhido = computed(() => (cids.data.value ?? []).find((c) => String(c.id) === cid.value) ?? null);
const opcoesCid = computed(() => [
  { valor: '', rotulo: t('adt.escolha') },
  ...(cids.data.value ?? []).map((c) => ({ valor: String(c.id), rotulo: `${c.codigo} ${c.nome}` })),
]);
const opcoesTipoDiag = computed(() =>
  (['principal', 'secundario', 'causa_externa'] as const).map((v) => ({
    valor: v,
    rotulo: t(`adt.registros.tipo.${v}`),
  })),
);
/** Na hora: o código do capítulo XX só entra como causa externa, e a causa externa só com código do capítulo XX. */
const dicaCid = computed(() => {
  const c = cidEscolhido.value;
  if (!c) return null;
  const externa = ehCausaExterna(c.codigo);
  if (externa && tipoDiag.value !== 'causa_externa') return t('adt.registros.dicaCausaExterna');
  if (!externa && tipoDiag.value === 'causa_externa') return t('adt.registros.dicaCausaExterna');
  return null;
});
function escolherCid(v: string): void {
  cid.value = v;
  const c = cidEscolhido.value;
  if (c && ehCausaExterna(c.codigo)) tipoDiag.value = 'causa_externa';
}
const gravarDiagnostico = () =>
  acao(
    () =>
      registrarDiagnostico(
        reg.value,
        {
          cid: Number(cid.value),
          tipo: tipoDiag.value,
          ...(observacao.value.trim() ? { observacao: observacao.value.trim() } : {}),
        },
        novaChave('diagnostico'),
      ),
    () => {
      cid.value = '';
      observacao.value = '';
    },
  );

// ── Retirada com motivo (exclusão lógica) ──
const retirando = ref<number | null>(null);
const motivo = ref('');
const gravarRetirada = () =>
  acao(
    () =>
      retirarDiagnostico(reg.value, retirando.value!, motivo.value.trim(), novaChave('diagnostico-retirada')),
    () => {
      retirando.value = null;
      motivo.value = '';
    },
  );

// ── Acidente ──
const acidente = ref({
  tipo: 'trabalho',
  ocorridoEm: '',
  local: '',
  empregadorCnpj: '',
  empregadorNome: '',
  numeroComunicacao: '',
  comunicacaoEmitidaEm: '',
  descricao: '',
});
const opcoesAcidente = computed(() =>
  TIPOS_ACIDENTE.map((v) => ({ valor: v, rotulo: t(`adt.registros.tiposAcidente.${v}`) })),
);
const preenchido = (s: string) => (s.trim() ? s.trim() : undefined);
const corpoAcidente = computed(() => {
  const a = acidente.value;
  return {
    tipo: a.tipo as (typeof TIPOS_ACIDENTE)[number],
    ocorridoEm: a.ocorridoEm ? `${a.ocorridoEm}:00` : undefined,
    local: preenchido(a.local),
    empregadorCnpj: preenchido(a.empregadorCnpj),
    empregadorNome: preenchido(a.empregadorNome),
    numeroComunicacao: preenchido(a.numeroComunicacao),
    comunicacaoEmitidaEm: a.comunicacaoEmitidaEm || undefined,
    descricao: preenchido(a.descricao),
  };
});
/** A mesma regra do servidor, na hora (o servidor confere de novo). */
const conferencia = computed(() => {
  const f = ficha.data.value;
  if (!f) return null;
  const r = conferirAcidente(corpoAcidente.value, f.entrada);
  return r.ok ? null : r.motivo;
});
const gravarAcidente = () =>
  acao(
    () =>
      registrarAcidente(
        reg.value,
        Object.fromEntries(Object.entries(corpoAcidente.value).filter(([, v]) => v !== undefined)),
        novaChave('acidente'),
      ),
    () => {
      acidente.value = { ...acidente.value, numeroComunicacao: '', comunicacaoEmitidaEm: '', descricao: '' };
    },
  );
</script>

<template>
  <section class="tela-agenda" aria-labelledby="registros-titulo" data-testid="tela-registros-internacao">
    <h1 id="registros-titulo">{{ t('adt.registros.titulo') }}</h1>
    <p>{{ t('adt.registros.texto') }}</p>
    <AvisoAdt :motivo="aviso" />
    <ErroAdt v-if="ficha.isError.value" :erro="ficha.error.value" />
    <p v-else-if="!ficha.data.value" role="status">{{ t('adt.carregando') }}</p>
    <template v-else>
      <ResumoInternacao :internacao="ficha.data.value" atalhos />
      <p v-if="mensagem" role="status" data-testid="registros-gravado">{{ mensagem }}</p>
      <p v-if="semBanco" role="status" class="secundario" data-testid="registros-sem-banco">
        {{ t('adt.registros.semBanco') }}
      </p>
      <ErroAdt v-else-if="erro" :erro="erro" />

      <section class="painel" aria-labelledby="registros-diagnosticos">
        <h2 id="registros-diagnosticos">{{ t('adt.registros.diagnosticos') }}</h2>
        <table v-if="registros" class="tabela" data-testid="tabela-diagnosticos">
          <thead>
            <tr>
              <th scope="col">{{ t('adt.registros.sequencia') }}</th>
              <th scope="col">{{ t('adt.registros.tipoCol') }}</th>
              <th scope="col">{{ t('adt.registros.cid') }}</th>
              <th scope="col">{{ t('adt.registros.registradoEm') }}</th>
              <th scope="col">{{ t('adt.registros.situacaoCol') }}</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="d in registros.diagnosticos"
              :key="d.sequencia"
              :data-testid="`diagnostico-${d.sequencia}`"
            >
              <td>{{ d.sequencia }}</td>
              <td>{{ t(`adt.registros.tipo.${d.tipo}`) }}</td>
              <td>
                {{ d.codigo }} {{ d.nome }}
                <small v-if="d.observacao" class="secundario">{{ d.observacao }}</small>
              </td>
              <td>{{ dataBr(d.registradoEm) }}</td>
              <td>
                {{ t(`adt.registros.situacao.${d.situacao}`) }}
                <small v-if="d.motivoRetirada" class="secundario">
                  {{ t('adt.registros.retiradoPor', { motivo: d.motivoRetirada }) }}
                </small>
              </td>
              <td>
                <SanteBotao
                  v-if="podeRetirar && d.situacao === 'vigente' && d.tipo !== 'entrada'"
                  :rotulo="t('adt.registros.retirar')"
                  variante="secundario"
                  :data-testid="`diagnostico-retirar-${d.sequencia}`"
                  @acionar="retirando = d.sequencia"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="retirando !== null" class="filtros" data-testid="diagnostico-retirada">
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('adt.registros.motivoRetirada')"
            :max-bytes="400"
            obrigatorio
            data-testid="diagnostico-retirada-motivo"
          />
          <SanteBotao
            :rotulo="t('adt.registros.confirmarRetirada')"
            :desabilitado="motivo.trim().length < 5 || ocupado"
            data-testid="diagnostico-retirada-gravar"
            @acionar="gravarRetirada"
          />
          <SanteBotao
            :rotulo="t('adt.registros.cancelar')"
            variante="secundario"
            @acionar="retirando = null"
          />
        </div>

        <template v-if="podeDiagnostico">
          <h3>{{ t('adt.registros.novoDiagnostico') }}</h3>
          <form class="filtros" role="search" @submit.prevent="pedidoCid = termoCid.trim()">
            <SanteCampoTexto
              v-model="termoCid"
              :rotulo="t('adt.registros.termoCid')"
              :max-bytes="60"
              data-testid="registros-termo-cid"
            />
            <SanteBotao
              tipo="submit"
              variante="secundario"
              :rotulo="t('adt.buscar')"
              data-testid="registros-buscar-cid"
            />
          </form>
          <div class="filtros">
            <SanteSelecao
              :model-value="cid"
              :rotulo="t('adt.registros.cid')"
              :opcoes="opcoesCid"
              data-testid="registros-cid"
              @update:model-value="escolherCid(String($event))"
            />
            <SanteSelecao
              v-model="tipoDiag"
              :rotulo="t('adt.registros.tipoCol')"
              :opcoes="opcoesTipoDiag"
              data-testid="registros-tipo"
            />
            <SanteCampoTexto v-model="observacao" :rotulo="t('adt.registros.observacao')" :max-bytes="1000" />
          </div>
          <p v-if="dicaCid" class="secundario" data-testid="registros-dica-cid">{{ dicaCid }}</p>
          <p v-else-if="tipoDiag === 'principal'" class="secundario">
            {{ t('adt.registros.dicaPrincipal') }}
          </p>
          <SanteBotao
            :rotulo="t('adt.registros.gravarDiagnostico')"
            :desabilitado="!cid || !!dicaCid || ocupado"
            data-testid="registros-gravar-diagnostico"
            @acionar="gravarDiagnostico"
          />
        </template>
      </section>

      <section class="painel" aria-labelledby="registros-acidentes">
        <h2 id="registros-acidentes">{{ t('adt.registros.acidentes') }}</h2>
        <p v-if="registros && registros.acidentes.length === 0" class="secundario">
          {{ t('adt.registros.semAcidente') }}
        </p>
        <ul v-else-if="registros" data-testid="lista-acidentes">
          <li v-for="a in registros.acidentes" :key="a.sequencia" :data-testid="`acidente-${a.sequencia}`">
            {{ a.sequencia }}. {{ t(`adt.registros.tiposAcidente.${a.tipo}`) }}
            <span v-if="a.ocorridoEm">({{ dataBr(a.ocorridoEm) }})</span>
            <span v-if="a.empregadorNome"> · {{ a.empregadorNome }}</span>
            <span v-if="a.numeroComunicacao"> · {{ a.numeroComunicacao }}</span>
          </li>
        </ul>
        <template v-if="podeAcidente">
          <h3>{{ t('adt.registros.novoAcidente') }}</h3>
          <div class="filtros">
            <SanteSelecao
              v-model="acidente.tipo"
              :rotulo="t('adt.registros.tipoAcidente')"
              :opcoes="opcoesAcidente"
              data-testid="acidente-tipo"
            />
            <div class="campo">
              <label for="acidente-ocorrido">{{ t('adt.registros.ocorridoEm') }}</label>
              <input
                id="acidente-ocorrido"
                v-model="acidente.ocorridoEm"
                type="datetime-local"
                data-testid="acidente-ocorrido"
              />
            </div>
            <SanteCampoTexto v-model="acidente.local" :rotulo="t('adt.registros.local')" :max-bytes="255" />
            <SanteCampoTexto
              v-model="acidente.empregadorCnpj"
              :rotulo="t('adt.registros.empregadorCnpj')"
              :max-bytes="18"
              data-testid="acidente-cnpj"
            />
            <SanteCampoTexto
              v-model="acidente.empregadorNome"
              :rotulo="t('adt.registros.empregadorNome')"
              :max-bytes="150"
              data-testid="acidente-empregador"
            />
            <SanteCampoTexto
              v-model="acidente.numeroComunicacao"
              :rotulo="t('adt.registros.numeroComunicacao')"
              :max-bytes="30"
            />
            <div class="campo">
              <label for="acidente-comunicacao">{{ t('adt.registros.comunicacaoEmitidaEm') }}</label>
              <input id="acidente-comunicacao" v-model="acidente.comunicacaoEmitidaEm" type="date" />
            </div>
            <SanteCampoTexto
              v-model="acidente.descricao"
              :rotulo="t('adt.registros.descricao')"
              :max-bytes="2000"
            />
          </div>
          <p v-if="conferencia" class="secundario" role="alert" data-testid="acidente-conferencia">
            {{ conferencia }}
          </p>
          <SanteBotao
            :rotulo="t('adt.registros.gravarAcidente')"
            :desabilitado="!!conferencia || ocupado"
            data-testid="acidente-gravar"
            @acionar="gravarAcidente"
          />
        </template>
      </section>
    </template>
  </section>
</template>

<style src="../../agenda/componentes/estilo-agenda.css"></style>
