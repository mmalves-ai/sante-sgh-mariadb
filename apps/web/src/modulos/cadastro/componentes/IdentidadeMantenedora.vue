<script setup lang="ts">
// Mantenedora do estabelecimento (F3.1, 02-CAD linha 26). Uma tela só: a mantenedora ligada com todos os dados, ou a
// escolha entre ligar uma já cadastrada (rede com vários hospitais) e incluir a nova. O CNPJ e as regras do domínio
// (data de registro sem número, operadora sem registro na agência, registro do contador sem contador) são conferidos
// na hora e seguram a gravação. Responsável legal e contador entram pelo CPF inteiro (nunca lista de pessoas por
// nome). Desligar e inativar pedem motivo; nada é apagado.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  CHAVE_IDENTIDADE,
  cnpjConfere,
  type Corpo,
  gravarMantenedora,
  lerIdentidade,
  ligarMantenedora,
  type Mantenedora,
  pessoaPorCpf,
  situacaoMantenedora,
} from '../api-identidade.js';

const { t } = useI18n();
const T = (k: string, p?: Record<string, unknown>) => t(`identidadeEstabelecimento.${k}`, p ?? {});
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: CHAVE_IDENTIDADE, queryFn: lerIdentidade });
const dados = computed(() => consulta.data.value);
const erro = ref<unknown>(null);
const ok = ref(false);

async function fazer(fn: () => Promise<unknown>, depois?: () => void): Promise<void> {
  erro.value = null;
  ok.value = false;
  try {
    await fn();
    ok.value = true;
    depois?.();
    await cliente.invalidateQueries({ queryKey: CHAVE_IDENTIDADE });
  } catch (e) {
    erro.value = e;
  }
}

const so = (v: unknown) => String(v ?? '').replace(/\D+/g, '');
const vazio = (v: unknown) => String(v ?? '').trim() === '';

const nova = (): Corpo => ({
  id: null,
  versao: null,
  codigo: '',
  razaoSocial: '',
  nomeFantasia: '',
  cnpj: '',
  naturezaJuridica: null,
  inscricaoEstadual: '',
  inscricaoMunicipal: '',
  nire: '',
  dataRegistroNire: '',
  registroCivil: '',
  dataRegistroCivil: '',
  cnaePrincipal: '',
  registroAns: '',
  optanteSimples: false,
  filantropica: false,
  incentivoCultural: false,
  tipoDeclarante: null,
  responsavel: null,
  responsavelNome: null,
  contador: null,
  contadorNome: null,
  contadorCrc: '',
  site: '',
  ligar: true,
});
const ficha = ref<Corpo | null>(null);
// A mantenedora ligada abre direto no formulário (nenhum clique para ver ou corrigir).
watch(
  dados,
  (d) => {
    if (d && (ficha.value === null || ficha.value['id'] !== null))
      ficha.value = d.mantenedora ? { ...d.mantenedora, ligar: true } : null;
  },
  { immediate: true },
);

const TEXTOS = [
  'codigo',
  'razaoSocial',
  'nomeFantasia',
  'cnpj',
  'inscricaoEstadual',
  'inscricaoMunicipal',
  'nire',
  'registroCivil',
  'cnaePrincipal',
  'registroAns',
  'site',
] as const;
const DATAS = ['dataRegistroNire', 'dataRegistroCivil'] as const;
const MARCAS = ['optanteSimples', 'filantropica', 'incentivoCultural'] as const;

// Validação na hora: cada aviso segura a gravação.
const avisos = computed<string[]>(() => {
  const f = ficha.value;
  if (!f) return [];
  const a: string[] = [];
  if (so(f['cnpj']) !== '' && !cnpjConfere(so(f['cnpj']))) a.push('cnpjNaoConfere');
  if (
    (vazio(f['nire']) && !vazio(f['dataRegistroNire'])) ||
    (vazio(f['registroCivil']) && !vazio(f['dataRegistroCivil']))
  )
    a.push('dataSemNumero');
  if (
    (f['tipoDeclarante'] === 'operadora' || f['tipoDeclarante'] === 'prestador_e_operadora') &&
    vazio(f['registroAns'])
  )
    a.push('operadoraSemRegistro');
  if (f['contador'] === null && !vazio(f['contadorCrc'])) a.push('crcSemContador');
  return a;
});
const podeGravar = computed(() => {
  const f = ficha.value;
  return (
    !!f && !avisos.value.length && !vazio(f['codigo']) && !vazio(f['razaoSocial']) && so(f['cnpj']) !== ''
  );
});

// Responsável legal e contador pelo CPF inteiro.
const cpf = ref<Record<'responsavel' | 'contador', string>>({ responsavel: '', contador: '' });
const naoAchou = ref<Record<'responsavel' | 'contador', boolean>>({ responsavel: false, contador: false });
async function buscarPessoa(quem: 'responsavel' | 'contador'): Promise<void> {
  naoAchou.value[quem] = false;
  erro.value = null;
  try {
    const r = await pessoaPorCpf(so(cpf.value[quem]));
    if (!r.pessoa || !ficha.value) {
      naoAchou.value[quem] = true;
      return;
    }
    ficha.value[quem] = r.pessoa.id;
    ficha.value[`${quem}Nome`] = r.pessoa.nome;
    cpf.value[quem] = '';
  } catch (e) {
    erro.value = e;
  }
}
function retirarPessoa(quem: 'responsavel' | 'contador'): void {
  if (!ficha.value) return;
  ficha.value[quem] = null;
  ficha.value[`${quem}Nome`] = null;
}

// Ligar, desligar, inativar e reativar: sempre com motivo.
const acao = ref<{ tipo: 'ligar' | 'desligar' | 'situacao'; alvo: Mantenedora | null } | null>(null);
const motivo = ref('');
const escolhida = ref<number | null>(null);
const outras = computed(() =>
  (dados.value?.mantenedoras ?? []).filter((m) => m.id !== dados.value?.mantenedora?.id),
);
function confirmar(): Promise<void> {
  const a = acao.value!;
  const fim = () => ((acao.value = null), (motivo.value = ''));
  if (a.tipo === 'situacao')
    return fazer(
      () =>
        situacaoMantenedora(a.alvo!.id, {
          versao: a.alvo!.versao,
          ativo: !a.alvo!.ativo,
          motivo: motivo.value,
        }),
      fim,
    );
  return fazer(
    () => ligarMantenedora({ mantenedora: a.tipo === 'ligar' ? a.alvo!.id : null, motivo: motivo.value }),
    () => (fim(), a.tipo === 'desligar' && (ficha.value = null)),
  );
}
const rotuloAcao = computed(() => {
  const a = acao.value;
  if (!a) return '';
  if (a.tipo === 'ligar') return T('mantenedora.ligar');
  if (a.tipo === 'desligar') return T('mantenedora.desligar');
  return a.alvo!.ativo ? T('mantenedora.inativar') : T('mantenedora.reativar');
});
</script>

<template>
  <section aria-labelledby="mantenedora-titulo">
    <h2 id="mantenedora-titulo">{{ T('mantenedora.titulo') }}</h2>
    <p>{{ T('mantenedora.ajuda') }}</p>
    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <MensagemErro v-if="erro" :erro="erro" />
    <p v-if="ok" role="status" data-testid="mantenedora-gravada">{{ T('comum.gravado') }}</p>
    <p v-if="consulta.isPending.value">{{ T('comum.carregando') }}</p>

    <template v-else-if="dados">
      <div v-if="!dados.mantenedora && !ficha" class="linha">
        <p data-testid="sem-mantenedora">{{ T('mantenedora.semMantenedora') }}</p>
        <SanteBotao
          :rotulo="T('mantenedora.nova')"
          data-testid="nova-mantenedora"
          @acionar="ficha = nova()"
        />
      </div>

      <!-- Ficha: a ligada (já aberta) ou a nova -->
      <form
        v-if="ficha"
        class="grade"
        @submit.prevent="
          fazer(
            () => gravarMantenedora(ficha!['id'] as number | null, ficha!),
            () => ficha!['id'] === null && (ficha = null),
          )
        "
      >
        <label v-for="c in TEXTOS" :key="c">
          {{ T(`mantenedora.${c}`) }}
          <input
            v-model="ficha[c] as string"
            :name="`mantenedora-${c}`"
            :aria-invalid="c === 'cnpj' && avisos.includes('cnpjNaoConfere')"
          />
        </label>
        <label v-for="c in DATAS" :key="c">
          {{ T(`mantenedora.${c}`) }}
          <input v-model="ficha[c] as string" type="date" :name="`mantenedora-${c}`" />
        </label>
        <SanteSelecao
          v-model="ficha['naturezaJuridica'] as number | null"
          :rotulo="T('mantenedora.naturezaJuridica')"
          :opcoes="[
            { valor: null, rotulo: T('comum.escolha') },
            ...dados.opcoes.naturezas.map((n) => ({ valor: n.id, rotulo: n.descricao })),
          ]"
          data-testid="mantenedora-natureza"
        />
        <SanteSelecao
          v-model="ficha['tipoDeclarante'] as string | null"
          :rotulo="T('mantenedora.tipoDeclarante')"
          :opcoes="[
            { valor: null, rotulo: T('comum.nenhuma') },
            ...dados.opcoes.tiposDeclarante.map((d) => ({
              valor: d,
              rotulo: T(`mantenedora.tiposDeclarante.${d}`),
            })),
          ]"
          data-testid="mantenedora-declarante"
        />
        <label v-for="c in MARCAS" :key="c" class="marca"
          ><input v-model="ficha[c]" type="checkbox" :name="`mantenedora-${c}`" />
          {{ T(`mantenedora.${c}`) }}</label
        >
        <fieldset v-for="q in ['responsavel', 'contador'] as const" :key="q" class="pessoa">
          <legend>{{ T(`mantenedora.${q}`) }}</legend>
          <template v-if="ficha[q] !== null">
            <span :data-testid="`mantenedora-${q}-nome`">{{ ficha[`${q}Nome`] }}</span>
            <button type="button" @click="retirarPessoa(q)">{{ T('mantenedora.retirar') }}</button>
          </template>
          <template v-else>
            <label
              >{{ T('mantenedora.cpf', { quem: T(`mantenedora.${q}`).toLowerCase() }) }}
              <input v-model="cpf[q]" :name="`cpf-${q}`" inputmode="numeric" maxlength="14"
            /></label>
            <button
              type="button"
              :disabled="so(cpf[q]).length !== 11"
              :data-testid="`buscar-${q}`"
              @click="buscarPessoa(q)"
            >
              {{ T('mantenedora.buscar') }}
            </button>
            <small v-if="naoAchou[q]" class="aviso" role="alert">{{
              T('mantenedora.pessoaNaoEncontrada')
            }}</small>
          </template>
        </fieldset>
        <label
          >{{ T('mantenedora.contadorCrc') }}
          <input v-model="ficha['contadorCrc'] as string" name="mantenedora-contadorCrc" maxlength="20"
        /></label>
        <label v-if="ficha['id'] === null" class="marca"
          ><input v-model="ficha['ligar']" type="checkbox" name="mantenedora-ligar" />
          {{ T('mantenedora.ligarAoGravar') }}</label
        >
        <ul v-if="avisos.length" class="avisos" data-testid="mantenedora-avisos">
          <li v-for="a in avisos" :key="a" class="aviso">{{ T(`mantenedora.${a}`) }}</li>
        </ul>
        <div class="linha">
          <SanteBotao
            tipo="submit"
            :rotulo="T('comum.gravar')"
            :desabilitado="!podeGravar"
            data-testid="gravar-mantenedora"
          />
          <SanteBotao
            v-if="ficha['id'] === null"
            variante="secundario"
            :rotulo="T('comum.cancelar')"
            @acionar="ficha = null"
          />
          <SanteBotao
            v-else
            variante="secundario"
            :rotulo="T('mantenedora.desligar')"
            data-testid="desligar-mantenedora"
            @acionar="((acao = { tipo: 'desligar', alvo: null }), (motivo = ''))"
          />
        </div>
      </form>

      <!-- As outras mantenedoras do cliente: ligar este estabelecimento, inativar ou reativar -->
      <template v-if="outras.length">
        <h3>{{ T('mantenedora.outras') }}</h3>
        <SanteSelecao
          v-model="escolhida"
          :rotulo="T('mantenedora.outras')"
          :opcoes="[
            { valor: null, rotulo: T('comum.escolha') },
            ...outras.map((m) => ({
              valor: m.id,
              rotulo: `${m.codigo} · ${m.razaoSocial}${m.ativo ? '' : ` (${T('comum.inativo')})`}`,
            })),
          ]"
          data-testid="outra-mantenedora"
        />
        <div v-for="m in outras.filter((x) => x.id === escolhida)" :key="m.id" class="linha">
          <span>{{ T('mantenedora.estabelecimentos') }}: {{ m.estabelecimentos }}</span>
          <SanteBotao
            v-if="m.ativo"
            :rotulo="T('mantenedora.ligar')"
            data-testid="ligar-mantenedora"
            @acionar="((acao = { tipo: 'ligar', alvo: m }), (motivo = ''))"
          />
          <SanteBotao
            variante="secundario"
            :rotulo="m.ativo ? T('mantenedora.inativar') : T('mantenedora.reativar')"
            :desabilitado="m.ativo && m.estabelecimentos > 0"
            data-testid="situacao-mantenedora"
            @acionar="((acao = { tipo: 'situacao', alvo: m }), (motivo = ''))"
          />
        </div>
      </template>

      <form v-if="acao" class="grade" @submit.prevent="confirmar()">
        <label
          >{{ T('comum.motivo') }} <input v-model="motivo" name="motivo-mantenedora" maxlength="200"
        /></label>
        <SanteBotao
          tipo="submit"
          :rotulo="rotuloAcao"
          :desabilitado="motivo.trim().length < 10"
          data-testid="confirmar-mantenedora"
        />
        <SanteBotao variante="secundario" :rotulo="T('comum.cancelar')" @acionar="acao = null" />
      </form>
    </template>
  </section>
</template>

<style scoped>
.grade {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
  gap: var(--sgh-espaco-2) var(--sgh-espaco-3);
  margin-top: var(--sgh-espaco-3);
}
.grade label {
  display: flex;
  flex-direction: column;
}
.grade label.marca {
  flex-direction: row;
  gap: var(--sgh-espaco-1);
  align-items: center;
}
.pessoa {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.avisos {
  grid-column: 1 / -1;
  margin: 0;
  padding-left: var(--sgh-espaco-3);
}
.aviso {
  color: var(--sgh-alerta);
}
</style>
